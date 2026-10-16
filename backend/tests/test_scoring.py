from backend.app.domain.scoring import (
    calculate_score,
    has_readiness_mismatch,
    readiness_gap,
    score_control_scenario,
    zone_for_score,
)


def test_unknown_legal_basis_never_counts_as_r1():
    result = calculate_score([], "not_checked")
    assert result["score"] == 0
    assert result["zone"] == "green"
    assert any(item["factor_code"] == "R1" for item in result["needs_review"])


def test_control_scenarios_a_b_c():
    a = score_control_scenario(["R2", "R3"])
    b = score_control_scenario(["R1", "R2", "R3"], "absent")
    c = score_control_scenario(["R3"], "confirmed")
    assert (a["score"], a["zone"]) == (35, "yellow")
    assert (b["score"], b["zone"]) == (70, "red")
    assert (c["score"], c["zone"]) == (10, "green")


def test_red_requires_r1_and_r2_and_score_threshold():
    no_r1 = calculate_score(
        [
            {"factor_code": "R2", "status": "fact"},
            {"factor_code": "R3", "status": "fact"},
            {"factor_code": "R4", "status": "fact"},
            {"factor_code": "R5", "status": "fact"},
        ],
        "confirmed",
    )
    assert no_r1["score"] == 60
    assert no_r1["zone"] == "yellow"
    red = calculate_score([{"factor_code": code, "status": "fact"} for code in ("R1", "R2", "R3")], "absent")
    assert red["zone"] == "red"


def test_hypotheses_do_not_add_points():
    result = calculate_score([{"id": 7, "factor_code": "R2", "status": "ai_hypothesis"}])
    assert result["score"] == 0
    assert result["needs_review"][0]["evidence_id"] == 7


def test_zone_boundaries_24_25_59_60():
    assert zone_for_score(24, False, False)[0] == "green"
    assert zone_for_score(25, False, False)[0] == "yellow"
    assert zone_for_score(59, True, True)[0] == "yellow"
    assert zone_for_score(60, True, True)[0] == "red"


def test_score_is_capped_at_100_and_duplicate_codes_score_once(monkeypatch):
    from backend.app.domain import scoring

    monkeypatch.setattr(scoring, "WEIGHTS", {code: 50 for code in ("R1", "R2", "R3", "R4", "R5", "R6")})
    evidence = [{"factor_code": code, "status": "fact"} for code in ("R1", "R2", "R3", "R4", "R5", "R6")]
    evidence.extend([{"factor_code": "R2", "status": "fact"}] * 5)
    assert calculate_score(evidence)["score"] == 100


def test_readiness_mismatch_starts_at_20_percentage_points():
    assert readiness_gap(60, 41) == 19
    assert not has_readiness_mismatch(60, 41)
    assert readiness_gap(60, 40) == 20
    assert has_readiness_mismatch(60, 40)
    assert not has_readiness_mismatch(60, None)
