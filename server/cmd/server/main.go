package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/invite"
	mw "github.com/bowlinedandy/spraywall/server/internal/middleware"
	"github.com/bowlinedandy/spraywall/server/internal/oidc"
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
	if err := storageClient.EnsureBucket(context.Background()); err != nil {
		log.Fatalf("Unable to prepare storage bucket: %v", err)
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.StripSlashes)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
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

	passwordEnabled, err := oidc.PasswordLoginEnabled()
	if err != nil {
		log.Fatal(err)
	}
	oidcConfig, err := oidc.LoadConfig()
	if err != nil {
		log.Fatal(err)
	}
	if !passwordEnabled && !oidcConfig.Enabled {
		log.Fatal("PASSWORD_LOGIN_ENABLED=false requires OIDC to be configured (OIDC_ISSUER_URL)")
	}

	authOpts := user.Options{
		PasswordEnabled:  passwordEnabled,
		Storage:          storageClient,
		OIDCIssuer:       oidcConfig.IssuerURL,
		OIDCProviderName: oidcConfig.ProviderName,
	}
	if oidcConfig.Enabled && oidcConfig.AdminGroup != "" {
		authOpts.AdminRoleMaxAge = oidcConfig.AdminMaxAge
	}
	authHandler := user.NewHandler(queries, jwtSecret, pool, authOpts)

	var oidcHandler *oidc.Handler
	if oidcConfig.Enabled {
		oidcHandler, err = oidc.New(context.Background(), oidcConfig, queries, pool, authHandler, storageClient, jwtSecret)
		if err != nil {
			log.Fatalf("Unable to configure OIDC: %v", err)
		}
		log.Printf("OIDC login enabled via %s", oidcConfig.IssuerURL)
	}

	// Auth routes
	authLimiter := mw.NewRateLimiter(10, time.Minute)
	r.Route("/auth", func(r chi.Router) {
		// Polled by the login page; not rate limited.
		r.Get("/config", oidc.ConfigHandler(passwordEnabled, oidcConfig))

		r.Group(func(r chi.Router) {
			r.Use(authLimiter.Handler)
			r.Post("/register", authHandler.Register)
			r.Post("/login", authHandler.Login)
			r.Post("/refresh", authHandler.Refresh)
			r.Post("/logout", authHandler.Logout)
			r.With(authHandler.Authenticate).Get("/me", authHandler.Me)

			if oidcHandler != nil {
				r.Get("/oidc/login", oidcHandler.Login)
				r.Get("/oidc/callback", oidcHandler.Callback)
				r.With(authHandler.Authenticate).Post("/oidc/link", oidcHandler.Link)
			}
		})
	})

	// Handlers
	routeHandler := route.NewHandler(queries, pool)
	routeHandler.SetImmichClient(route.NewImmichClient(strings.Split(os.Getenv("IMMICH_ALLOWED_HOSTS"), ",")))
	wallHandler := wall.NewHandler(queries, storageClient, pool)
	inviteHandler := invite.NewHandler(queries, pool)

	// Public media proxies use unguessable UUIDs and work with native img/video elements.
	r.Get("/images/*", wallHandler.ServeImage)
	r.Get("/beta-media/{videoId}/{kind}", routeHandler.ServeBetaMedia)

	// Current user's profile and logbook (authenticated, outside gyms)
	r.Route("/users/me", func(r chi.Router) {
		r.Use(authHandler.Authenticate)
		r.Patch("/", authHandler.UpdateMe)
		r.Put("/password", authHandler.ChangePassword)
		r.Post("/avatar", authHandler.UploadAvatar)
		r.Delete("/avatar", authHandler.DeleteAvatar)
		r.Delete("/identities/{id}", authHandler.UnlinkIdentity)
		r.Get("/logbook", routeHandler.Logbook)
	})

	// Public invite routes
	r.Route("/invites/{token}", func(r chi.Router) {
		r.Get("/", inviteHandler.ValidateInvite)
		r.With(authHandler.Authenticate).Post("/accept", inviteHandler.AcceptInvite)
	})

	// Gym & wall routes (authenticated)
	r.Route("/gyms", func(r chi.Router) {
		r.Use(authHandler.Authenticate)
		r.Post("/", wallHandler.CreateGym)
		r.Get("/", wallHandler.ListGyms)
		r.Route("/{gymSlug}", func(r chi.Router) {
			r.Get("/", wallHandler.GetGym)
			r.Delete("/", wallHandler.DeleteGym)
			r.Post("/members", wallHandler.AddMember)
			r.Post("/invites", inviteHandler.CreateInvite)
			r.Route("/walls", func(r chi.Router) {
				r.Post("/", wallHandler.CreateWall)
				r.Get("/", wallHandler.ListWalls)
				r.Route("/{wallId}", func(r chi.Router) {
					r.Get("/", wallHandler.GetWall)
					r.Get("/activity", routeHandler.WallActivity)
					r.Delete("/", wallHandler.DeleteWall)
					r.Post("/images", wallHandler.UploadImage)
					r.Route("/resets/{imageId}", func(r chi.Router) {
						r.Get("/", wallHandler.GetReset)
						r.Put("/matches", wallHandler.UpdateResetMatch)
						r.Delete("/holds/{holdId}", wallHandler.DeleteResetHold)
						r.Post("/restore", wallHandler.RestoreResetHold)
						r.Post("/apply", wallHandler.ApplyReset)
						r.Delete("/", wallHandler.DiscardReset)
					})
					r.Get("/holds", wallHandler.GetHolds)
					r.Post("/holds", wallHandler.CreateHold)
					r.Route("/circuits", func(r chi.Router) {
						r.Get("/", routeHandler.ListCircuits)
						r.Post("/", routeHandler.CreateCircuit)
						r.Route("/{circuitId}", func(r chi.Router) {
							r.Get("/", routeHandler.GetCircuit)
							r.Patch("/", routeHandler.PatchCircuit)
							r.Delete("/", routeHandler.DeleteCircuit)
							r.Put("/routes", routeHandler.ReplaceCircuitRoutes)
							r.Post("/routes", routeHandler.AppendCircuitRoute)
							r.Delete("/routes/{routeId}", routeHandler.DeleteCircuitRoute)
						})
					})
					r.Delete("/holds/{holdId}", wallHandler.DeleteHold)
					r.Route("/routes", func(r chi.Router) {
						r.Post("/", routeHandler.CreateRoute)
						r.Get("/", routeHandler.ListRoutes)
						r.Route("/{routeId}", func(r chi.Router) {
							r.Get("/", routeHandler.GetRoute)
							r.Get("/activity", routeHandler.RouteActivity)
							r.Get("/beta-videos", routeHandler.RouteBetaVideos)
							r.Post("/beta-videos", routeHandler.CreateBetaVideo)
							r.Delete("/beta-videos/{videoId}", routeHandler.DeleteBetaVideo)
							r.Put("/", routeHandler.UpdateRoute)
							r.Delete("/", routeHandler.DeleteRoute)
							r.Patch("/publish", routeHandler.PublishRoute)
							r.Route("/logs", func(r chi.Router) {
								r.Get("/", routeHandler.GetLogs)
								r.Post("/", routeHandler.CreateLog)
								r.Put("/{logId}", routeHandler.UpdateLog)
								r.Delete("/{logId}", routeHandler.DeleteLog)
							})
							r.Put("/rating", routeHandler.SetRating)
							r.Delete("/rating", routeHandler.DeleteRating)
							r.Post("/sends", routeHandler.LegacyLogSend)
							r.Delete("/sends/me", routeHandler.LegacyRemoveSend)
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
