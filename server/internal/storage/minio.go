package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Client struct {
	mc             *minio.Client
	bucket         string
	publicEndpoint string
}

func New() (*Client, error) {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	accessKey := os.Getenv("MINIO_ROOT_USER")
	secretKey := os.Getenv("MINIO_ROOT_PASSWORD")
	bucket := os.Getenv("MINIO_BUCKET")
	publicEndpoint := os.Getenv("MINIO_PUBLIC_ENDPOINT")

	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, fmt.Errorf("minio client: %w", err)
	}

	return &Client{mc: mc, bucket: bucket, publicEndpoint: publicEndpoint}, nil
}

func (c *Client) Upload(ctx context.Context, key string, reader io.Reader, size int64, contentType string) error {
	_, err := c.mc.PutObject(ctx, c.bucket, key, reader, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	return err
}

func (c *Client) PresignedURL(ctx context.Context, key string) (string, error) {
	u, err := c.mc.PresignedGetObject(ctx, c.bucket, key, time.Hour, nil)
	if err != nil {
		return "", err
	}
	result := u.String()
	if c.publicEndpoint != "" {
		internalHost := c.mc.EndpointURL().Host
		result = strings.Replace(result, "://"+internalHost+"/", "://"+c.publicEndpoint+"/", 1)
	}
	return result, nil
}
