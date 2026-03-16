package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/invite"
	mw "github.com/bowlinedandy/spraywall/server/internal/middleware"
	"github.com/bowlinedandy/spraywall/server/internal/route"
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

	storageClient, err := storage.New()
	if err != nil {
		log.Fatalf("Unable to create storage client: %v", err)
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.StripSlashes)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// Health check with DB connectivity
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		dbStatus := "ok"
		if err := pool.Ping(r.Context()); err != nil {
			dbStatus = "error"
		}
		status := "ok"
		if dbStatus != "ok" {
			status = "degraded"
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		json.NewEncoder(w).Encode(map[string]string{
			"status": status,
			"db":     dbStatus,
		})
	})

	// Auth routes (rate limited)
	authLimiter := mw.NewRateLimiter(10, time.Minute)
	authHandler := user.NewHandler(queries, jwtSecret, pool)
	r.Route("/auth", func(r chi.Router) {
		r.Use(authLimiter.Handler)
		r.Post("/register", authHandler.Register)
		r.Post("/login", authHandler.Login)
		r.Post("/refresh", authHandler.Refresh)
		r.Post("/logout", authHandler.Logout)
		r.With(user.AuthMiddleware(jwtSecret)).Get("/me", authHandler.Me)
	})

	// Handlers
	routeHandler := route.NewHandler(queries)
	wallHandler := wall.NewHandler(queries, storageClient)
	inviteHandler := invite.NewHandler(queries, pool)

	// Image proxy (no auth required, keys are unguessable UUIDs)
	r.Get("/images/*", wallHandler.ServeImage)

	// Logbook (authenticated, outside gyms)
	r.With(user.AuthMiddleware(jwtSecret)).Get("/users/me/logbook", routeHandler.Logbook)

	// Public invite routes
	r.Route("/invites/{token}", func(r chi.Router) {
		r.Get("/", inviteHandler.ValidateInvite)
		r.With(user.AuthMiddleware(jwtSecret)).Post("/accept", inviteHandler.AcceptInvite)
	})

	// Gym & wall routes (authenticated)
	r.Route("/gyms", func(r chi.Router) {
		r.Use(user.AuthMiddleware(jwtSecret))
		r.Post("/", wallHandler.CreateGym)
		r.Get("/", wallHandler.ListGyms)
		r.Route("/{gymSlug}", func(r chi.Router) {
			r.Get("/", wallHandler.GetGym)
			r.Post("/members", wallHandler.AddMember)
			r.Post("/invites", inviteHandler.CreateInvite)
			r.Route("/walls", func(r chi.Router) {
				r.Post("/", wallHandler.CreateWall)
				r.Get("/", wallHandler.ListWalls)
				r.Route("/{wallId}", func(r chi.Router) {
					r.Get("/", wallHandler.GetWall)
					r.Post("/images", wallHandler.UploadImage)
					r.Get("/holds", wallHandler.GetHolds)
					r.Route("/routes", func(r chi.Router) {
						r.Post("/", routeHandler.CreateRoute)
						r.Get("/", routeHandler.ListRoutes)
						r.Route("/{routeId}", func(r chi.Router) {
							r.Get("/", routeHandler.GetRoute)
							r.Delete("/", routeHandler.DeleteRoute)
							r.Post("/sends", routeHandler.LogSend)
							r.Delete("/sends/me", routeHandler.RemoveSend)
						})
					})
				})
			})
		})
	})

	log.Printf("Server starting on :%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal(err)
	}
}
