package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/aethercode/aethercode/libs/pkg/database"
)

func main() {
	var databaseURL string
	var sourceURL string
	var direction string

	flag.StringVar(&databaseURL, "database-url", "", "PostgreSQL migration URL")
	flag.StringVar(&sourceURL, "source", "", "golang-migrate source URL")
	flag.StringVar(&direction, "direction", "up", "migration direction: up or down")
	flag.Parse()

	if databaseURL == "" || sourceURL == "" {
		fmt.Fprintln(os.Stderr, "database-url and source are required")
		os.Exit(2)
	}

	var err error
	switch direction {
	case "up":
		err = database.MigrateUp(databaseURL, sourceURL)
	case "down":
		err = database.MigrateDown(databaseURL, sourceURL)
	default:
		fmt.Fprintln(os.Stderr, "direction must be up or down")
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
