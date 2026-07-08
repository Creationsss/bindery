package importer

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/vavallee/bindery/internal/db"
	"github.com/vavallee/bindery/internal/models"
)

type stubMetadataResolver struct {
	searchResults []models.Book
	isbnBook      *models.Book
	searchCalls   int
	isbnCalls     int
	asinCalls     int
}

func (m *stubMetadataResolver) SearchBooks(_ context.Context, _ string) ([]models.Book, error) {
	m.searchCalls++
	return m.searchResults, nil
}

func (m *stubMetadataResolver) ResolveBookByISBN(_ context.Context, _ string) (*models.Book, error) {
	m.isbnCalls++
	return m.isbnBook, nil
}

func (m *stubMetadataResolver) GetCanonicalBookByASIN(_ context.Context, _ string) (*models.Book, error) {
	m.asinCalls++
	return nil, nil
}

func (m *stubMetadataResolver) ResolveCanonicalAuthor(_ context.Context, _ string) (*models.Author, error) {
	return nil, errors.New("no canonical author")
}

func metadataBook(title, foreignID, authorName, authorForeignID string) models.Book {
	return models.Book{
		ForeignID:        foreignID,
		Title:            title,
		MetadataProvider: "openlibrary",
		Author: &models.Author{
			ForeignID:        authorForeignID,
			Name:             authorName,
			MetadataProvider: "openlibrary",
		},
	}
}

func runAutoAddImport(t *testing.T, s *Scanner, downloads *db.DownloadRepo, ctx context.Context, downloadPath, guid, title string) *models.Download {
	t.Helper()
	dl := &models.Download{GUID: guid, Title: title, BookID: nil, Status: models.StateCompleted, NZBURL: "fake://url"}
	if err := downloads.Create(ctx, dl); err != nil {
		t.Fatal(err)
	}
	s.tryImportInternal(ctx, dl, downloadPath, "", "", "", nil, nil)
	reloaded, err := downloads.GetByGUID(ctx, guid)
	if err != nil {
		t.Fatal(err)
	}
	return reloaded
}

func libraryHasExt(t *testing.T, dir, ext string) bool {
	t.Helper()
	var found bool
	_ = filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && filepath.Ext(p) == ext {
			found = true
		}
		return nil
	})
	return found
}

func TestImport_AutoAddsBookFromMetadataSearch(t *testing.T) {
	s, downloads, books, authors, _, libraryDir, ctx := unmatchedFixture(t)

	stub := &stubMetadataResolver{
		searchResults: []models.Book{metadataBook("Dracula", "OL-DRACULA", "Bram Stoker", "OL-STOKER")},
	}
	s.WithMetadata(stub)

	downloadDir := t.TempDir()
	writeEpubAt(t, filepath.Join(downloadDir, "Dracula by Bram Stoker.epub"), "Dracula", "Bram Stoker", "")

	reloaded := runAutoAddImport(t, s, downloads, ctx, downloadDir, "guid-autoadd", "Dracula by Bram Stoker")
	if reloaded.Status != models.StateImported {
		t.Fatalf("status = %q (error %q), want %q", reloaded.Status, reloaded.ErrorMessage, models.StateImported)
	}
	if reloaded.BookID == nil {
		t.Fatal("BookID not set on download after auto-add")
	}

	book, err := books.GetByID(ctx, *reloaded.BookID)
	if err != nil || book == nil {
		t.Fatalf("auto-added book not found: %v", err)
	}
	if book.ForeignID != "OL-DRACULA" || book.Title != "Dracula" {
		t.Errorf("book = %q (%s), want Dracula (OL-DRACULA)", book.Title, book.ForeignID)
	}
	if book.MediaType != models.MediaTypeEbook {
		t.Errorf("media type = %q, want ebook", book.MediaType)
	}

	author, err := authors.GetByID(ctx, book.AuthorID)
	if err != nil || author == nil {
		t.Fatalf("auto-added author not found: %v", err)
	}
	if author.Name != "Bram Stoker" || author.ForeignID != "OL-STOKER" {
		t.Errorf("author = %q (%s), want Bram Stoker (OL-STOKER)", author.Name, author.ForeignID)
	}
	if author.MonitorMode != models.AuthorMonitorModeNone {
		t.Errorf("monitor mode = %q, want none", author.MonitorMode)
	}

	if !libraryHasExt(t, libraryDir, ".epub") {
		t.Error("no epub found under library dir after import")
	}
}

func TestImport_AutoAddsAudiobookFromReleaseTitle(t *testing.T) {
	s, downloads, books, _, _, libraryDir, ctx := unmatchedFixture(t)

	stub := &stubMetadataResolver{
		searchResults: []models.Book{metadataBook("Dracula", "OL-DRACULA", "Bram Stoker", "OL-STOKER")},
	}
	s.WithMetadata(stub)

	downloadDir := t.TempDir()
	audioDir := filepath.Join(downloadDir, "Dracula by Bram Stoker [Audible 64k]")
	if err := os.MkdirAll(audioDir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(audioDir, "Dracula.m4b"), []byte("audio"), 0o600); err != nil {
		t.Fatal(err)
	}

	reloaded := runAutoAddImport(t, s, downloads, ctx, audioDir, "guid-autoadd-audio", "Dracula by Bram Stoker [Audible 64k]")
	if reloaded.Status != models.StateImported {
		t.Fatalf("status = %q (error %q), want %q", reloaded.Status, reloaded.ErrorMessage, models.StateImported)
	}
	if reloaded.BookID == nil {
		t.Fatal("BookID not set on download after auto-add")
	}
	book, err := books.GetByID(ctx, *reloaded.BookID)
	if err != nil || book == nil {
		t.Fatalf("auto-added book not found: %v", err)
	}
	if book.MediaType != models.MediaTypeAudiobook {
		t.Errorf("media type = %q, want audiobook", book.MediaType)
	}

	if !libraryHasExt(t, libraryDir, ".m4b") {
		t.Error("no m4b found under library dir after import")
	}
}

func TestImport_AutoAddPrefersEmbeddedISBN(t *testing.T) {
	s, downloads, _, _, _, _, ctx := unmatchedFixture(t)

	isbnBook := metadataBook("Pandora's Star", "OL-PS", "Peter F. Hamilton", "OL-PFH")
	stub := &stubMetadataResolver{
		isbnBook:      &isbnBook,
		searchResults: []models.Book{metadataBook("Wrong Book", "OL-WRONG", "Somebody Else", "OL-SE")},
	}
	s.WithMetadata(stub)

	downloadDir := t.TempDir()
	writeEpubAt(t, filepath.Join(downloadDir, "release.epub"), "Pandora's Star", "Peter F. Hamilton", "9780345472199")

	reloaded := runAutoAddImport(t, s, downloads, ctx, downloadDir, "guid-isbn", "release")
	if reloaded.Status != models.StateImported {
		t.Fatalf("status = %q (error %q), want %q", reloaded.Status, reloaded.ErrorMessage, models.StateImported)
	}
	if stub.isbnCalls == 0 {
		t.Error("ISBN resolution was never attempted")
	}
	if stub.searchCalls != 0 {
		t.Error("free-text metadata search ran despite an ISBN resolution")
	}
}

func TestImport_AutoAddRejectsAuthorMismatch(t *testing.T) {
	s, downloads, books, authors, _, _, ctx := unmatchedFixture(t)

	stub := &stubMetadataResolver{
		searchResults: []models.Book{metadataBook("Dracula", "OL-SUMMARY", "Summary Press", "OL-SP")},
	}
	s.WithMetadata(stub)

	downloadDir := t.TempDir()
	writeEpubAt(t, filepath.Join(downloadDir, "Dracula by Bram Stoker.epub"), "Dracula", "Bram Stoker", "")

	reloaded := runAutoAddImport(t, s, downloads, ctx, downloadDir, "guid-mismatch", "Dracula by Bram Stoker")
	if reloaded.Status != models.StateImportFailed {
		t.Fatalf("status = %q, want %q", reloaded.Status, models.StateImportFailed)
	}
	if reloaded.BookID != nil {
		t.Error("BookID set despite author mismatch")
	}
	allBooks, err := books.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(allBooks) != 0 {
		t.Errorf("books created = %d, want 0", len(allBooks))
	}
	allAuthors, err := authors.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(allAuthors) != 0 {
		t.Errorf("authors created = %d, want 0", len(allAuthors))
	}
}

func TestImport_AutoAddDisabledBySetting(t *testing.T) {
	s, downloads, _, _, settings, _, ctx := unmatchedFixture(t)

	stub := &stubMetadataResolver{
		searchResults: []models.Book{metadataBook("Dracula", "OL-DRACULA", "Bram Stoker", "OL-STOKER")},
	}
	s.WithMetadata(stub)
	if err := settings.Set(ctx, autoAddSettingKey, "false"); err != nil {
		t.Fatal(err)
	}

	downloadDir := t.TempDir()
	writeEpubAt(t, filepath.Join(downloadDir, "Dracula by Bram Stoker.epub"), "Dracula", "Bram Stoker", "")

	reloaded := runAutoAddImport(t, s, downloads, ctx, downloadDir, "guid-disabled", "Dracula by Bram Stoker")
	if reloaded.Status != models.StateImportFailed {
		t.Fatalf("status = %q, want %q", reloaded.Status, models.StateImportFailed)
	}
	if stub.searchCalls != 0 || stub.isbnCalls != 0 || stub.asinCalls != 0 {
		t.Error("metadata resolver was called while auto-add is disabled")
	}
}

func TestImport_AutoAddReusesExistingAuthorByName(t *testing.T) {
	s, downloads, books, authors, _, _, ctx := unmatchedFixture(t)

	existing := &models.Author{ForeignID: "HC-STOKER", Name: "Bram Stoker", SortName: "Stoker, Bram", Monitored: true, MetadataProvider: "hardcover"}
	if err := authors.Create(ctx, existing); err != nil {
		t.Fatal(err)
	}

	stub := &stubMetadataResolver{
		searchResults: []models.Book{metadataBook("Dracula", "OL-DRACULA", "Bram Stoker", "OL-STOKER")},
	}
	s.WithMetadata(stub)

	downloadDir := t.TempDir()
	writeEpubAt(t, filepath.Join(downloadDir, "Dracula by Bram Stoker.epub"), "Dracula", "Bram Stoker", "")

	reloaded := runAutoAddImport(t, s, downloads, ctx, downloadDir, "guid-reuse", "Dracula by Bram Stoker")
	if reloaded.Status != models.StateImported {
		t.Fatalf("status = %q (error %q), want %q", reloaded.Status, reloaded.ErrorMessage, models.StateImported)
	}
	allAuthors, err := authors.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(allAuthors) != 1 {
		t.Fatalf("authors = %d, want 1 (existing author reused)", len(allAuthors))
	}
	if reloaded.BookID == nil {
		t.Fatal("BookID not set")
	}
	book, err := books.GetByID(ctx, *reloaded.BookID)
	if err != nil || book == nil {
		t.Fatal(err)
	}
	if book.AuthorID != existing.ID {
		t.Errorf("book.AuthorID = %d, want existing author %d", book.AuthorID, existing.ID)
	}
	aliased, err := authors.GetByAnyForeignIDForUser(ctx, "OL-STOKER", 0)
	if err != nil {
		t.Fatal(err)
	}
	if aliased == nil || aliased.ID != existing.ID {
		t.Error("resolved foreign ID was not attached as an alias on the reused author")
	}
}

func TestImport_AutoAddStillPrefersCatalogueMatch(t *testing.T) {
	s, downloads, books, authors, _, _, ctx := unmatchedFixture(t)

	author := &models.Author{ForeignID: "OL-STOKER", Name: "Bram Stoker", SortName: "Stoker, Bram", Monitored: true, MetadataProvider: "openlibrary"}
	if err := authors.Create(ctx, author); err != nil {
		t.Fatal(err)
	}
	book := &models.Book{
		ForeignID: "OL-DRACULA", AuthorID: author.ID, Title: "Dracula", SortTitle: "dracula",
		Status: models.BookStatusWanted, Monitored: true, AnyEditionOK: true,
		MediaType: models.MediaTypeEbook, MetadataProvider: "openlibrary",
	}
	if err := books.Create(ctx, book); err != nil {
		t.Fatal(err)
	}

	stub := &stubMetadataResolver{
		searchResults: []models.Book{metadataBook("Dracula", "OL-OTHER", "Bram Stoker", "OL-STOKER2")},
	}
	s.WithMetadata(stub)

	downloadDir := t.TempDir()
	writeEpubAt(t, filepath.Join(downloadDir, "Dracula by Bram Stoker.epub"), "Dracula", "Bram Stoker", "")

	reloaded := runAutoAddImport(t, s, downloads, ctx, downloadDir, "guid-catalogue-first", "Dracula by Bram Stoker")
	if reloaded.BookID == nil || *reloaded.BookID != book.ID {
		t.Fatalf("BookID = %v, want catalogue book %d", reloaded.BookID, book.ID)
	}
	if stub.searchCalls != 0 {
		t.Error("metadata search ran despite a catalogue match")
	}
}
