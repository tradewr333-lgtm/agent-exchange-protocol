from pathlib import Path
import sys

package_root = Path(__file__).resolve().parents[1]
repo_packages = package_root.parent
sys.path.insert(0, str(package_root / "src"))
sys.path.insert(0, str(repo_packages / "axp-sdk-python" / "src"))

from axp_autogen import AxpAutoGenToolkit


def main() -> None:
    toolkit = AxpAutoGenToolkit()
    tools = toolkit.get_tools()

    print(tools[0]["function"](status="active", service="research", min_capacity=100))
    print(tools[2]["function"](agent_id="agent_0002"))
    print(
        tools[1]["function"](
            requester_agent_id="agent_0001",
            provider_agent_id="agent_0002",
            service="research",
            requested_capacity=100,
        )
    )


if __name__ == "__main__":
    main()
