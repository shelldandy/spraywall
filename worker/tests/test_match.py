from detection.match import match_holds


def hold(x, y=0.2, w=0.1, h=0.1):
    return {"bbox": {"x": x, "y": y, "w": w, "h": h}, "polygon": None}


IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


def test_matches_shifted_holds_and_ignores_added_and_removed_holds():
    new_holds = [hold(0.2), hold(0.5)]  # second hold is newly added
    old_holds = [hold(0.3), hold(0.8)]  # second old hold was removed
    shift_new_to_old = [[1, 0, 0.1], [0, 1, 0], [0, 0, 1]]

    matches = match_holds(new_holds, old_holds, shift_new_to_old)

    assert [(match["new_index"], match["old_index"]) for match in matches] == [(0, 0)]
    assert matches[0]["iou"] > 0.99


def test_matches_one_to_one_in_normalized_coordinates():
    new_holds = [hold(0.2), hold(0.21), hold(0.7)]
    old_holds = [hold(0.2), hold(0.7)]

    matches = match_holds(new_holds, old_holds, IDENTITY)

    assert {(match["new_index"], match["old_index"]) for match in matches} == {(0, 0), (2, 1)}
    assert len({match["new_index"] for match in matches}) == len(matches)
    assert len({match["old_index"] for match in matches}) == len(matches)


def test_center_distance_breaks_equal_iou_ties_for_small_holds():
    new_holds = [hold(0.25, y=0.25, w=0.125, h=0.125)]
    # Both candidates have exactly 1/3 IoU, but the first center is nearer.
    old_holds = [
        hold(0.3125, y=0.25, w=0.125, h=0.125),
        hold(0.28125, y=0.25, w=0.25, h=0.125),
    ]

    matches = match_holds(new_holds, old_holds, IDENTITY)

    assert len(matches) == 1
    assert matches[0]["old_index"] == 0


def test_exact_candidate_ties_choose_lowest_old_index_deterministically():
    new_holds = [hold(0.2)]
    old_holds = [hold(0.2), hold(0.2)]

    matches = match_holds(new_holds, old_holds, IDENTITY)

    assert len(matches) == 1
    assert matches[0]["old_index"] == 0


def test_inverse_projects_old_hold_into_new_coordinates():
    # new -> old shifts x by 0.1; old x=.3 therefore corresponds to new x=.2.
    matches = match_holds([hold(0.2)], [hold(0.3)], [[1, 0, 0.1], [0, 1, 0], [0, 0, 1]])

    assert len(matches) == 1
    assert matches[0]["iou"] > 0.99
