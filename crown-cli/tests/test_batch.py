import click
from pathlib import Path
import pytest


import sys
sys.path.insert(0, str(Path(__file__).parent.parent.resolve() / "src"))

from crown_cli.core.batch import discover_inputs, spawn_job


def test_discover_single_file(tmp_path):
    f = tmp_path / "sub01.nii.gz"
    f.touch()
    result = discover_inputs([str(f)])
    assert result == [f]


def test_discover_multiple_files(tmp_path):
    f1 = tmp_path / "sub01.nii.gz"
    f2 = tmp_path / "sub02.nii.gz"
    f1.touch(); f2.touch()
    result = discover_inputs([str(f1), str(f2)])
    assert set(result) == {f1, f2}


def test_discover_directory(tmp_path):
    (tmp_path / "sub01.nii.gz").touch()
    (tmp_path / "sub02.nii").touch()
    (tmp_path / "notes.txt").touch()
    result = discover_inputs([str(tmp_path)])
    assert len(result) == 2
    assert all(p.suffix in {".gz", ".nii"} for p in result)


def test_discover_nonexistent_raises(tmp_path):
    with pytest.raises(click.BadParameter):
        discover_inputs([str(tmp_path / "nonexistent.nii.gz")])
