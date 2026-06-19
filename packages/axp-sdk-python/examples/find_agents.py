from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from axp import AxpClient


def main() -> None:
    axp = AxpClient()
    agents = axp.find_agents(status="active", service="research", min_capacity=100)
    capacity = axp.get_capacity_score("agent_0002")

    print("AXP active research agents:", agents["count"])
    print("Agent Beta capacity:", capacity["available_capacity"])


if __name__ == "__main__":
    main()
