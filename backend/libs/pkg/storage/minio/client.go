package minio

import (
	"context"
	"fmt"
	"io"
	"time"

	miniogo "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/aethercode/aethercode/libs/pkg/storage"
)

// Compile-time assertion: Client must implement storage.Object.
var _ storage.Object = (*Client)(nil)

// Client wraps the MinIO SDK client and binds it to a single bucket.
type Client struct {
	client *miniogo.Client
	bucket string
}

// New initialises a MinIO/S3 client from cfg. The bucket must already exist.
func New(cfg Config) (*Client, error) {
	c, err := miniogo.New(cfg.Endpoint, &miniogo.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("minio: create client: %w", err)
	}
	return &Client{client: c, bucket: cfg.Bucket}, nil
}

// Put uploads r under key with the given contentType.
func (c *Client) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	_, err := c.client.PutObject(ctx, c.bucket, key, r, size, miniogo.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

// Get returns a reader and the exact byte size for the object at key.
// The caller must close the reader.
func (c *Client) Get(ctx context.Context, key string) (io.ReadCloser, int64, error) {
	obj, err := c.client.GetObject(ctx, c.bucket, key, miniogo.GetObjectOptions{})
	if err != nil {
		return nil, 0, err
	}
	info, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		return nil, 0, err
	}
	return obj, info.Size, nil
}

// Delete removes the object at key. Missing objects are not an error.
func (c *Client) Delete(ctx context.Context, key string) error {
	return c.client.RemoveObject(ctx, c.bucket, key, miniogo.RemoveObjectOptions{})
}

// Exists reports whether key names an existing object.
func (c *Client) Exists(ctx context.Context, key string) (bool, error) {
	_, err := c.client.StatObject(ctx, c.bucket, key, miniogo.StatObjectOptions{})
	if err != nil {
		if miniogo.ToErrorResponse(err).Code == "NoSuchKey" {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// PresignGet returns a pre-signed GET URL valid for expiry.
func (c *Client) PresignGet(ctx context.Context, key string, expiry time.Duration) (string, error) {
	u, err := c.client.PresignedGetObject(ctx, c.bucket, key, expiry, nil)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}
