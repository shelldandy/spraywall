package route

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/db/generated"
)

type routeSummary struct {
	sendCount     int
	hasSent       bool
	progress      string
	hasFlashed    bool
	ratingAverage *float64
	ratingCount   int
	myRating      *int
}

// summarizeRoutes runs separate batched log and rating aggregates so repeats
// never multiply successful-event counts or rating weights.
func (h *Handler) summarizeRoutes(ctx context.Context, routes []generated.Route, userID pgtype.UUID) (map[pgtype.UUID]routeSummary, error) {
	out := make(map[pgtype.UUID]routeSummary, len(routes))
	if len(routes) == 0 {
		return out, nil
	}
	ids := make([]pgtype.UUID, len(routes))
	for i, route := range routes {
		ids[i] = route.ID
		out[route.ID] = routeSummary{progress: "not_tried"}
	}
	logs, err := h.queries.GetRouteLogSummaries(ctx, generated.GetRouteLogSummariesParams{Column1: ids, UserID: userID})
	if err != nil {
		return nil, err
	}
	for _, row := range logs {
		value := out[row.RouteID]
		value.sendCount = int(row.SendCount)
		value.hasSent = row.OwnSuccesses > 0
		value.hasFlashed = row.HasFlashed
		if row.OwnSuccesses > 0 {
			value.progress = "sent"
		} else if row.OwnAttempts > 0 {
			value.progress = "projects"
		}
		out[row.RouteID] = value
	}
	ratings, err := h.queries.GetRouteRatingSummaries(ctx, generated.GetRouteRatingSummariesParams{Column1: ids, UserID: userID})
	if err != nil {
		return nil, err
	}
	for _, row := range ratings {
		value := out[row.RouteID]
		average := row.RatingAverage
		value.ratingAverage = &average
		value.ratingCount = int(row.RatingCount)
		if row.MyRating > 0 {
			rating := int(row.MyRating)
			value.myRating = &rating
		}
		out[row.RouteID] = value
	}
	return out, nil
}

func applySummary(response *routeResponse, summary routeSummary) {
	response.SendCount = summary.sendCount
	response.HasSent = summary.hasSent
	response.Progress = summary.progress
	response.HasFlashed = summary.hasFlashed
	response.RatingAverage = summary.ratingAverage
	response.RatingCount = summary.ratingCount
	response.MyRating = summary.myRating
}
