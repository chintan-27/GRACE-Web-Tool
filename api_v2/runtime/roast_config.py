"""
Default configuration and validation for ROAST simulations.
"""

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

DEFAULT_SIMULATION_TAG = "tDCSLAB"

# Conductivities: gel (S/m) and electrode (S/m) — applied per electrode
COND_GEL = 0.3
COND_ELECTRODE = 5.9e7


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
) -> dict:
    """
    Build the JSON config dict that roast_run.m reads.
    """
    recipe = recipe or DEFAULT_RECIPE
    validate_recipe(recipe)

    return {
        "t1_path": t1_path,
        "recipe": recipe,
        "electype": electype or DEFAULT_ELECTRODE_TYPE,
        "elecsize": elecsize or DEFAULT_ELECTRODE_SIZE,
        "elecori": elecori or DEFAULT_ELECTRODE_ORI,
        "meshoptions": meshoptions or DEFAULT_MESH_OPTIONS,
        "simulationtag": simulationtag or DEFAULT_SIMULATION_TAG,
    }
