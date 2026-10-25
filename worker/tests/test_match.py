import math

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


def ellipse_hold(cx, cy, rx=0.0125, ry=0.008, points=54):
    # SAM polygons are dense: ~50 vertices with sub-0.001 edges in normalized coordinates.
    angles = [2 * math.pi * i / points for i in range(points)]
    polygon = [[cx + rx * math.cos(a), cy + ry * math.sin(a)] for a in angles]
    bbox = {"x": cx - rx, "y": cy - ry, "w": 2 * rx, "h": 2 * ry}
    return {"bbox": bbox, "polygon": polygon}


def test_matches_small_dense_polygon_holds():
    # OpenCV's convex intersection used to return 0 for holds this small and dense.
    new_holds = [ellipse_hold(0.772, 0.711), ellipse_hold(0.2, 0.7)]
    old_holds = [ellipse_hold(0.770, 0.7105)]

    matches = match_holds(new_holds, old_holds, IDENTITY)

    assert [(match["new_index"], match["old_index"]) for match in matches] == [(0, 0)]
    assert matches[0]["iou"] > 0.5


def test_second_pass_matches_row_with_radial_scale_offset():
    new_holds = [hold(x, y=0.7, w=0.018, h=0.018) for x in [0.1 + i * 0.04 for i in range(21)]]
    old_holds = [
        hold(0.5 + (new_hold["bbox"]["x"] + 0.009 - 0.5) * 1.025 - 0.009, y=0.7, w=0.018, h=0.018)
        for new_hold in new_holds
    ]

    matches = match_holds(new_holds, old_holds, IDENTITY)

    assert len(matches) == len(new_holds)
    assert {(match["new_index"], match["old_index"]) for match in matches} == {
        (index, index) for index in range(len(new_holds))
    }
    assert all(match["iou"] >= 0 for match in matches)


def test_second_pass_leaves_distant_new_hold_unmatched():
    new_holds = [hold(x, y=0.7, w=0.018, h=0.018) for x in (0.2, 0.35, 0.5, 0.65)]
    old_holds = [hold(x + 0.001, y=0.7, w=0.018, h=0.018) for x in (0.2, 0.35, 0.5, 0.65)]
    new_holds.append(hold(0.5, y=0.2, w=0.018, h=0.018))

    matches = match_holds(new_holds, old_holds, IDENTITY)

    assert {(match["new_index"], match["old_index"]) for match in matches} == {
        (0, 0), (1, 1), (2, 2), (3, 3)
    }


def test_second_pass_does_not_replace_an_existing_high_overlap_match():
    new_holds = [hold(x, y=0.7, w=0.018, h=0.018) for x in (0.1, 0.3, 0.5, 0.7, 0.705)]
    old_holds = [hold(x, y=0.7, w=0.018, h=0.018) for x in (0.1, 0.3, 0.5, 0.7)]

    matches = match_holds(new_holds, old_holds, IDENTITY)

    assert (3, 3) in {(match["new_index"], match["old_index"]) for match in matches}


def test_second_pass_borrows_correction_from_own_row_not_wall_above():
    # A kickboard row is scaled relative to the main wall, whose holds sit just above
    # it and align perfectly; the row's own matched centre must drive the correction.
    wall = [hold(x, y=0.66, w=0.018, h=0.018) for x in [0.1 + i * 0.04 for i in range(21)]]
    feet = [hold(x, y=0.7, w=0.018, h=0.018) for x in [0.1 + i * 0.04 for i in range(21)]]
    scaled_feet = [
        hold(0.5 + (foot["bbox"]["x"] + 0.009 - 0.5) * 1.035 - 0.009, y=0.7, w=0.018, h=0.018)
        for foot in feet
    ]

    matches = match_holds(wall + feet, wall + scaled_feet, IDENTITY)

    assert {(match["new_index"], match["old_index"]) for match in matches} == {
        (index, index) for index in range(len(wall) + len(feet))
    }
