package buildinfo

// Version is set at build time via -ldflags "-X ...buildinfo.Version=...".
var Version = "dev"
