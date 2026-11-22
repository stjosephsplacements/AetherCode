// rebuild replays analytics gold rollups for one tenant (ADR-0067).
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	tenant := flag.String("tenant-id", "", "tenant UUID to rebuild")
	from := flag.String("from", "", "optional RFC3339 window start (accepted, silver rebuild is projection-based)")
	to := flag.String("to", "", "optional RFC3339 window end")
	flag.Parse()
	if *tenant == "" {
		log.Fatal("tenant-id is required")
	}
	databaseURL := os.Getenv("ANALYTICS_DATABASE_URL")
	if databaseURL == "" {
		databaseURL = os.Getenv("DATABASE_URL")
	}
	if databaseURL == "" {
		log.Fatal("ANALYTICS_DATABASE_URL or DATABASE_URL is required")
	}
	var fromTime, toTime *time.Time
	if *from != "" {
		parsed, err := time.Parse(time.RFC3339, *from)
		if err != nil {
			log.Fatalf("parse from: %v", err)
		}
		fromTime = &parsed
	}
	if *to != "" {
		parsed, err := time.Parse(time.RFC3339, *to)
		if err != nil {
			log.Fatalf("parse to: %v", err)
		}
		toTime = &parsed
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	if _, err := pool.Exec(context.Background(), `SELECT analytics.rebuild_medallion_gold($1::uuid, $2::timestamptz, $3::timestamptz)`, *tenant, fromTime, toTime); err != nil {
		log.Fatalf("rebuild: %v", err)
	}
	fmt.Println("gold rebuild complete")
}