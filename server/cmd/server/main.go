package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/storage"
	"github.com/bowlinedandy/spraywall/server/internal/user"
	"github.com/bowlinedandy/spraywall/server/internal/wall"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}

	// Database
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer pool.Close()

	queries := generated.New(pool)

	// MinIO storage
	storageClient, err := storage.New()
	if err != nil {
		log.Fatalf("Unable to create storage client: %v", err)
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Auth routes
	authHandler := user.NewHandler(queries, jwtSecret)
	r.Route("/auth", func(r chi.Router) {
		r.Post("/register", authHandler.Register)
		r.Post("/login", authHandler.Login)
		r.Post("/refresh", authHandler.Refresh)
		r.Post("/logout", authHandler.Logout)
		r.With(user.AuthMiddleware(jwtSecret)).Get("/me", authHandler.Me)
	})

	// Gym & wall routes (authenticated)
	wallHandler := wall.NewHandler(queries, storageClient)
	r.Route("/gyms", func(r chi.Router) {
		r.Use(user.AuthMiddleware(jwtSecret))
		r.Post("/", wallHandler.CreateGym)
		r.Get("/", wallHandler.ListGyms)
		r.Route("/{gymSlug}", func(r chi.Router) {
			r.Get("/", wallHandler.GetGym)
			r.Post("/members", wallHandler.AddMember)
			r.Route("/walls", func(r chi.Router) {
				r.Post("/", wallHandler.CreateWall)
				r.Get("/", wallHandler.ListWalls)
				r.Route("/{wallId}", func(r chi.Router) {
					r.Get("/", wallHandler.GetWall)
					r.Post("/images", wallHandler.UploadImage)
					r.Get("/holds", wallHandler.GetHolds)
				})
			})
		})
	})

	log.Printf("Server starting on :%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal(err)
	}
}
