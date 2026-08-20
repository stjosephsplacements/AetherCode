module github.com/aethercode/aethercode/services/user

go 1.26.0

toolchain go1.26.7

require (
	github.com/aethercode/aethercode/libs/pkg v0.0.0
	github.com/aethercode/aethercode/libs/proto v0.0.0
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.10.0
	github.com/stretchr/testify v1.11.1
	google.golang.org/grpc v1.82.1
	gorm.io/gorm v1.31.2
)

require (
	github.com/bmatcuk/doublestar/v4 v4.6.1 // indirect
	github.com/casbin/casbin/v2 v2.135.0 // indirect
	github.com/casbin/govaluate v1.3.0 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/golang-migrate/migrate/v4 v4.19.1 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	github.com/klauspost/compress v1.18.5 // indirect
	github.com/lib/pq v1.10.9 // indirect
	github.com/nats-io/nats.go v1.52.0 // indirect
	github.com/nats-io/nkeys v0.4.15 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	golang.org/x/crypto v0.50.0 // indirect
	golang.org/x/net v0.53.0 // indirect
	golang.org/x/sync v0.22.0 // indirect
	golang.org/x/sys v0.43.0 // indirect
	golang.org/x/text v0.41.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260414002931-afd174a4e478 // indirect
	google.golang.org/protobuf v1.36.11 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
	gorm.io/driver/postgres v1.6.0 // indirect
)

replace github.com/aethercode/aethercode/libs/pkg => ../../libs/pkg

replace github.com/aethercode/aethercode/libs/proto => ../../libs/proto
