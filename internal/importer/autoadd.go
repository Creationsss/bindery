package importer

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/vavallee/bindery/internal/db"
	"github.com/vavallee/bindery/internal/models"
	"github.com/vavallee/bindery/internal/textutil"
)

type MetadataResolver interface {
	SearchBooks(ctx context.Context, query string) ([]models.Book, error)
	ResolveBookByISBN(ctx context.Context, isbn string) (*models.Book, error)
	GetCanonicalBookByASIN(ctx context.Context, asin string) (*models.Book, error)
	ResolveCanonicalAuthor(ctx context.Context, name string) (*models.Author, error)
}

func (s *Scanner) WithMetadata(m MetadataResolver) *Scanner {
	s.meta = m
	return s
}

const autoAddSettingKey = "import.auto_add_books"

const autoAddResolveTimeout = 45 * time.Second

const autoAddMaxSearchResults = 5

func (s *Scanner) autoAddEnabled(ctx context.Context) bool {
	if s.settings == nil {
		return true
	}
	if v, err := s.settings.Get(ctx, autoAddSettingKey); err == nil && v != nil && v.Value == "false" {
		return false
	}
	return true
}

func (s *Scanner) recoverBookAssociation(ctx context.Context, dl *models.Download, bookFiles []string) (*models.Book, *models.Author) {
	b, a := s.matchBookForDownload(ctx, bookFiles)
	if b == nil {
		b, a = s.autoAddBookForDownload(ctx, dl, bookFiles)
	}
	if b == nil {
		return nil, nil
	}
	dl.BookID = &b.ID
	if err := s.downloads.SetBookID(ctx, dl.ID, b.ID); err != nil {
		slog.Warn("failed to persist recovered book association", "downloadID", dl.ID, "bookID", b.ID, "error", err)
	}
	slog.Info("recovered book association for unmatched download", "downloadID", dl.ID, "bookID", b.ID, "title", b.Title)
	return b, a
}

type bookIdentity struct {
	title  string
	author string
	isbn   string
	asin   string
}

func (id bookIdentity) empty() bool {
	return id.title == "" && id.isbn == "" && id.asin == ""
}

func downloadIdentitySignals(dl *models.Download, files []string) []bookIdentity {
	var out []bookIdentity
	for _, f := range files {
		if !IsEpubFile(f) {
			continue
		}
		meta, err := ReadEpubMetadata(f)
		if err != nil {
			continue
		}
		id := bookIdentity{title: meta.Title, author: meta.Author, isbn: meta.ISBN}
		if !id.empty() {
			out = append(out, id)
		}
	}
	names := files
	if dl != nil && strings.TrimSpace(dl.Title) != "" {
		names = append(append([]string(nil), files...), dl.Title)
	}
	for _, name := range names {
		p := ParseFilename(name)
		id := bookIdentity{title: p.Title, author: p.Author, isbn: p.ISBN, asin: p.ASIN}
		if !id.empty() {
			out = append(out, id)
		}
	}
	return out
}

func (s *Scanner) autoAddBookForDownload(ctx context.Context, dl *models.Download, files []string) (*models.Book, *models.Author) {
	if s.meta == nil || !s.autoAddEnabled(ctx) {
		return nil, nil
	}
	signals := downloadIdentitySignals(dl, files)
	if len(signals) == 0 {
		return nil, nil
	}

	resolveCtx, cancel := context.WithTimeout(ctx, autoAddResolveTimeout)
	defer cancel()

	resolved := s.resolveMetadataBook(resolveCtx, signals)
	if resolved == nil {
		slog.Info("auto-add: no confident metadata match for unmatched download", "downloadID", dl.ID, "title", dl.Title)
		return nil, nil
	}
	return s.persistResolvedBook(ctx, dl, resolved, files)
}

func (s *Scanner) resolveMetadataBook(ctx context.Context, signals []bookIdentity) *models.Book {
	seen := map[string]bool{}
	for _, sig := range signals {
		if sig.isbn == "" || seen["isbn:"+sig.isbn] {
			continue
		}
		seen["isbn:"+sig.isbn] = true
		b, err := s.meta.ResolveBookByISBN(ctx, sig.isbn)
		if err != nil {
			slog.Debug("auto-add: isbn resolution failed", "isbn", sig.isbn, "error", err)
			continue
		}
		if b != nil && b.ForeignID != "" {
			slog.Info("auto-add: resolved book via embedded ISBN", "isbn", sig.isbn, "title", b.Title)
			return b
		}
	}
	for _, sig := range signals {
		if sig.asin == "" || seen["asin:"+sig.asin] {
			continue
		}
		seen["asin:"+sig.asin] = true
		b, err := s.meta.GetCanonicalBookByASIN(ctx, sig.asin)
		if err != nil {
			slog.Debug("auto-add: asin resolution failed", "asin", sig.asin, "error", err)
			continue
		}
		if b != nil && b.ForeignID != "" && b.Author != nil && strings.TrimSpace(b.Author.Name) != "" {
			slog.Info("auto-add: resolved book via ASIN", "asin", sig.asin, "title", b.Title)
			return b
		}
	}
	for _, sig := range signals {
		if sig.title == "" {
			continue
		}
		query := strings.TrimSpace(sig.title + " " + sig.author)
		if seen["q:"+strings.ToLower(query)] {
			continue
		}
		seen["q:"+strings.ToLower(query)] = true
		results, err := s.meta.SearchBooks(ctx, query)
		if err != nil {
			slog.Debug("auto-add: metadata search failed", "query", query, "error", err)
			continue
		}
		if b := pickConfidentSearchResult(results, sig); b != nil {
			slog.Info("auto-add: resolved book via metadata search", "query", query, "title", b.Title, "foreignID", b.ForeignID)
			return b
		}
	}
	return nil
}

func pickConfidentSearchResult(results []models.Book, sig bookIdentity) *models.Book {
	limit := autoAddMaxSearchResults
	if sig.author == "" {
		limit = 1
	}
	if limit > len(results) {
		limit = len(results)
	}
	for i := 0; i < limit; i++ {
		b := &results[i]
		if b.ForeignID == "" || b.Author == nil || strings.TrimSpace(b.Author.Name) == "" || !titleMatch(b.Title, sig.title) {
			continue
		}
		if sig.author == "" || lookupAuthorMatch(sig.author, b.Author.Name) {
			return b
		}
	}
	return nil
}

func (s *Scanner) persistResolvedBook(ctx context.Context, dl *models.Download, resolved *models.Book, files []string) (*models.Book, *models.Author) {
	owner := s.downloadOwner(ctx, dl)

	existingByForeignID := func() (*models.Book, *models.Author) {
		existing, err := s.books.GetByForeignIDForUser(ctx, resolved.ForeignID, owner)
		if err != nil || existing == nil {
			return nil, nil
		}
		a, _ := s.authors.GetByID(ctx, existing.AuthorID)
		return existing, a
	}

	if b, a := existingByForeignID(); b != nil {
		return b, a
	}

	author := s.ensureAuthorForResolvedBook(ctx, resolved, owner)
	if author == nil {
		slog.Info("auto-add: could not resolve an author for matched book — leaving download unmatched", "downloadID", dl.ID, "bookTitle", resolved.Title)
		return nil, nil
	}

	if owned, err := s.books.FindByAuthorAndDedupKey(ctx, author.ID, resolved.Title); err == nil && owned != nil {
		return owned, author
	}

	book := *resolved
	book.ID = 0
	book.Author = nil
	book.AuthorID = author.ID
	book.Monitored = true
	book.Status = models.BookStatusWanted
	book.MediaType = detectDownloadFormat(files)
	if book.Genres == nil {
		book.Genres = []string{}
	}
	if book.MetadataProvider == "" {
		book.MetadataProvider = author.MetadataProvider
	}
	if err := s.books.Create(ctx, &book); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			if b, a := existingByForeignID(); b != nil {
				return b, a
			}
		}
		slog.Warn("auto-add: failed to create book", "title", book.Title, "error", err)
		return nil, nil
	}
	slog.Info("auto-added book for unmatched download", "downloadID", dl.ID, "bookID", book.ID, "title", book.Title, "author", author.Name)
	return &book, author
}

func (s *Scanner) ensureAuthorForResolvedBook(ctx context.Context, resolved *models.Book, owner int64) *models.Author {
	meta := resolved.Author
	if meta == nil || strings.TrimSpace(meta.Name) == "" {
		return nil
	}

	existingByForeignID := func(fid string) *models.Author {
		if strings.TrimSpace(fid) == "" {
			return nil
		}
		existing, err := s.authors.GetByAnyForeignIDForUser(ctx, fid, owner)
		if err != nil {
			return nil
		}
		return existing
	}

	if existing := existingByForeignID(meta.ForeignID); existing != nil {
		return existing
	}
	if existing := s.libraryAuthorByName(ctx, meta.Name, owner); existing != nil {
		if fid := strings.TrimSpace(meta.ForeignID); fid != "" {
			if err := s.authors.UpsertAuthorIdentifier(ctx, existing.ID, fid); err != nil && !errors.Is(err, db.ErrAuthorIdentifierConflict) {
				slog.Warn("auto-add: failed to attach author alias", "author", existing.Name, "foreignID", fid, "error", err)
			}
		}
		return existing
	}

	author := *meta
	if strings.TrimSpace(author.ForeignID) == "" {
		resolveCtx, cancel := context.WithTimeout(ctx, autoAddResolveTimeout)
		defer cancel()
		canonical, err := s.meta.ResolveCanonicalAuthor(resolveCtx, author.Name)
		if err != nil || canonical == nil || canonical.ForeignID == "" {
			return nil
		}
		if existing := existingByForeignID(canonical.ForeignID); existing != nil {
			return existing
		}
		author = *canonical
	}
	author.ID = 0
	author.Monitored = true
	author.MonitorMode = models.AuthorMonitorModeNone
	author.MonitorNewItems = models.AuthorMonitorNewItemsNone
	if author.SortName == "" {
		author.SortName = authorSortName(author.Name)
	}
	if author.MetadataProvider == "" {
		author.MetadataProvider = "openlibrary"
	}
	if author.MetadataProfileID == nil {
		def := models.DefaultMetadataProfileID
		author.MetadataProfileID = &def
	}
	if err := s.authors.CreateForUser(ctx, &author, owner); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") || errors.Is(err, db.ErrAuthorIdentifierConflict) {
			if existing := existingByForeignID(author.ForeignID); existing != nil {
				return existing
			}
		}
		slog.Warn("auto-add: failed to create author", "name", author.Name, "error", err)
		return nil
	}
	slog.Info("auto-added author for unmatched download", "authorID", author.ID, "name", author.Name, "foreignID", author.ForeignID)
	return &author
}

func (s *Scanner) libraryAuthorByName(ctx context.Context, name string, owner int64) *models.Author {
	key := textutil.NormalizeAuthorName(name)
	if key == "" {
		return nil
	}
	authors, err := s.authors.ListByUser(ctx, owner)
	if err != nil {
		return nil
	}
	matchIdx := -1
	for i := range authors {
		if textutil.NormalizeAuthorName(authors[i].Name) != key {
			continue
		}
		if matchIdx >= 0 {
			return nil
		}
		matchIdx = i
	}
	if matchIdx < 0 {
		return nil
	}
	return &authors[matchIdx]
}

func (s *Scanner) downloadOwner(ctx context.Context, dl *models.Download) int64 {
	owner, ok, err := s.downloads.GetOwnerByID(ctx, dl.ID)
	if err != nil || !ok {
		return 0
	}
	return owner
}
