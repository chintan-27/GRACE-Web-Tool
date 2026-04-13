import click
from crown_cli.commands.run import run
from crown_cli.commands.segment import segment
from crown_cli.commands.simulate import simulate
from crown_cli.commands.status import status
from crown_cli.commands.models import models


@click.group()
@click.version_option()
def main():
    """CROWN CLI — whole-head MRI segmentation and TES simulation."""


main.add_command(run)
main.add_command(segment)
main.add_command(simulate)
main.add_command(status)
main.add_command(models)
