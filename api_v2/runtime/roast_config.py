"""
Default configuration and validation for ROAST simulations.
"""
import hashlib
import json

DEFAULT_RECIPE = ["F3", -2, "F4", 2]

DEFAULT_ELECTRODE_TYPE = ["pad", "pad"]

DEFAULT_ELECTRODE_SIZE = [[70, 50, 3], [70, 50, 3]]

DEFAULT_ELECTRODE_ORI = ["lr", "lr"]

DEFAULT_MESH_OPTIONS = {
    "radbound": 5,
    "angbound": 30,
    "distbound": 0.3,
    "reratio": 3,
    "maxvol": 10,
}

# Fast mode: coarser mesh, ~3x fewer elements vs standard, ~2-3x faster, slight accuracy loss.
# maxvol=50 was too coarse: electrodes are 3mm thick, so (50)^(1/3)≈3.7mm per element edge —
# the mesher couldn't fit even one layer, causing "Electrode not meshed properly" (code 249).
# maxvol=20 gives ~2.7mm edges, reliably capturing the electrode layer while staying fast.
FAST_MESH_OPTIONS = {
    "radbound": 7,
    "angbound": 30,
    "distbound": 0.5,
    "reratio": 3,
    "maxvol": 20,
}

DEFAULT_SIMULATION_TAG = "tDCSLAB"

# Conductivities: gel (S/m) and electrode (S/m) — applied per electrode
COND_GEL = 0.3
COND_ELECTRODE = 5.9e7


def _tag_from_config(recipe, electype, elecsize, elecori, meshoptions) -> str:
    """Generate a stable 8-char hex tag from the simulation config.
    Different electrode configs get different tags so ROAST files in the
    same working directory never conflict across re-runs."""
    key = json.dumps(
        {"r": recipe, "et": electype, "es": elecsize, "eo": elecori, "mo": meshoptions},
        sort_keys=True, default=str
    )
    return "sim_" + hashlib.md5(key.encode()).hexdigest()[:8]


def validate_recipe(recipe: list) -> None:
    """
    Validate that recipe is [elec, current, elec, current, ...] and currents sum to 0.
    """
    if len(recipe) % 2 != 0:
        raise ValueError("Recipe must have an even number of elements (electrode, current pairs).")

    currents = recipe[1::2]
    for c in currents:
        if not isinstance(c, (int, float)):
            raise ValueError(f"Recipe currents must be numbers, got: {c}")

    if abs(sum(currents)) > 1e-9:
        raise ValueError(
            f"Recipe currents must sum to 0 mA (got {sum(currents):.4f}). "
            "Check that your anode and cathode currents balance."
        )


def build_roast_config(
    t1_path: str,
    recipe: list | None = None,
    electype: list | None = None,
    elecsize: list | None = None,
    elecori: list | None = None,
    meshoptions: dict | None = None,
    simulationtag: str | None = None,
    quality: str = "standard",  # "fast" or "standard"
) -> dict:
    """
    Build the JSON config dict that roast_run.m reads.
    """
    recipe = recipe or DEFAULT_RECIPE
    validate_recipe(recipe)

    if meshoptions is None:
        meshoptions = FAST_MESH_OPTIONS if quality == "fast" else DEFAULT_MESH_OPTIONS

    return {
        "t1_path": t1_path,
        "recipe": recipe,
        "electype": electype or DEFAULT_ELECTRODE_TYPE,
        "elecsize": elecsize or DEFAULT_ELECTRODE_SIZE,
        "elecori": elecori or DEFAULT_ELECTRODE_ORI,
        "meshoptions": meshoptions,
        "simulationtag": simulationtag or _tag_from_config(recipe, electype, elecsize, elecori, meshoptions),
    }
