package wall

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeleteWallRemovesAndHidesPhotos(t *testing.T) {
	storage := &uploadTestStorage{}
	e := newUploadTestEnv(t, storage)

	image := httptest.NewRecorder()
	e.router.ServeHTTP(image, httptest.NewRequest(http.MethodGet, "/images/active.jpg", nil))
	if image.Code != http.StatusOK {
		t.Fatalf("referenced image status = %d", image.Code)
	}

	request := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/walls/%s", e.wallID), nil)
	request.Header.Set("Authorization", "Bearer "+e.token)
	response := httptest.NewRecorder()
	e.router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete wall status = %d: %s", response.Code, response.Body)
	}
	if len(storage.deleted) != 0 {
		t.Fatalf("delete handler removed objects synchronously: %v", storage.deleted)
	}
	var queued int
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM storage_deletions WHERE storage_key='active.jpg'`).Scan(&queued); err != nil {
		t.Fatal(err)
	}
	if queued != 1 {
		t.Fatalf("queued deletes = %d, want 1", queued)
	}
	if didWork, err := e.handler.deleteNextStoredImage(context.Background()); err != nil || !didWork {
		t.Fatalf("process queued image: didWork=%v err=%v", didWork, err)
	}
	if len(storage.deleted) != 1 || storage.deleted[0] != "active.jpg" {
		t.Fatalf("deleted keys = %v, want [active.jpg]", storage.deleted)
	}

	image = httptest.NewRecorder()
	e.router.ServeHTTP(image, httptest.NewRequest(http.MethodGet, "/images/active.jpg", nil))
	if image.Code != http.StatusNotFound {
		t.Fatalf("deleted image status = %d, want 404", image.Code)
	}
}

func TestFailedImageDeleteRemainsQueuedAndRetries(t *testing.T) {
	storage := &uploadTestStorage{deleteErr: fmt.Errorf("minio unavailable")}
	e := newUploadTestEnv(t, storage)
	request := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/walls/%s", e.wallID), nil)
	request.Header.Set("Authorization", "Bearer "+e.token)
	response := httptest.NewRecorder()
	e.router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete wall status = %d: %s", response.Code, response.Body)
	}

	if didWork, err := e.handler.deleteNextStoredImage(context.Background()); !didWork || err == nil {
		t.Fatalf("failed delete: didWork=%v err=%v, want queued failure", didWork, err)
	}
	var attempts, queued int
	if err := e.pool.QueryRow(context.Background(), `SELECT attempts, count(*) OVER() FROM storage_deletions WHERE storage_key='active.jpg'`).Scan(&attempts, &queued); err != nil {
		t.Fatal(err)
	}
	if attempts != 1 || queued != 1 {
		t.Fatalf("after failure attempts=%d queued=%d, want 1 and 1", attempts, queued)
	}
	storage.deleteErr = nil
	if _, err := e.pool.Exec(context.Background(), `UPDATE storage_deletions SET next_attempt_at=now()`); err != nil {
		t.Fatal(err)
	}
	if didWork, err := e.handler.deleteNextStoredImage(context.Background()); err != nil || !didWork {
		t.Fatalf("retry queued image: didWork=%v err=%v", didWork, err)
	}
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM storage_deletions WHERE storage_key='active.jpg'`).Scan(&queued); err != nil {
		t.Fatal(err)
	}
	if queued != 0 {
		t.Fatalf("successful retry left %d queue entries", queued)
	}
}

func TestFailedBestEffortImageDeleteIsQueued(t *testing.T) {
	storage := &uploadTestStorage{deleteErr: fmt.Errorf("minio unavailable")}
	e := newUploadTestEnv(t, storage)
	e.handler.deleteStorageObjectBestEffort("orphan.jpg", "test cleanup")
	var queued int
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM storage_deletions WHERE storage_key='orphan.jpg'`).Scan(&queued); err != nil {
		t.Fatal(err)
	}
	if queued != 1 {
		t.Fatalf("failed cleanup queued %d keys, want 1", queued)
	}
	storage.deleteErr = nil
	if didWork, err := e.handler.deleteNextStoredImage(context.Background()); err != nil || !didWork {
		t.Fatalf("retry orphan image: didWork=%v err=%v", didWork, err)
	}
}
