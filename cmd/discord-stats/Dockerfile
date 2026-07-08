FROM golang:1.26-alpine@sha256:9097beb5536220f7857bdcb65c1b4b340630dd7a70b85f03d5af29640b06693d AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /discord-stats ./cmd/discord-stats

FROM gcr.io/distroless/static-debian12:nonroot@sha256:d093aa3e30dbadd3efe1310db061a14da60299baff8450a17fe0ccc514a16639
COPY --from=builder /discord-stats /discord-stats
ENTRYPOINT ["/discord-stats"]
