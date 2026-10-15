package user

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/db/generated"
)

// GymMemberGetter looks up a gym membership (satisfied by *generated.Queries).
type GymMemberGetter interface {
	GetGymMember(ctx context.Context, arg generated.GetGymMemberParams) (generated.GymMember, error)
}

// EffectiveGymMember returns the caller's membership in the gym. Instance
// admins (current account role "admin", as resolved by Authenticate) act as
// gym admins everywhere, even without a gym_members row. Other users get
// pgx.ErrNoRows when they are not members.
func EffectiveGymMember(ctx context.Context, q GymMemberGetter, gymID pgtype.UUID) (generated.GymMember, error) {
	userID := pgUUID(GetUserID(ctx))
	member, err := q.GetGymMember(ctx, generated.GetGymMemberParams{
		GymID:  gymID,
		UserID: userID,
	})
	if GetUserRole(ctx) != string(generated.UserRoleAdmin) {
		return member, err
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return member, err
	}
	return generated.GymMember{GymID: gymID, UserID: userID, Role: generated.UserRoleAdmin}, nil
}
