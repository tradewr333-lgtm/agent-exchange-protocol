from pathlib import Path
import sys

package_root = Path(__file__).resolve().parents[1]
repo_packages = package_root.parent
sys.path.insert(0, str(package_root / "src"))
sys.path.insert(0, str(repo_packages / "axp-sdk-python" / "src"))

from axp_crewai import AXPFindAgentsTool, AXPGetCapacityTool, AXPQuoteContractTool


def main() -> None:
    find_agents = AXPFindAgentsTool()
    quote_contract = AXPQuoteContractTool()
    get_capacity = AXPGetCapacityTool()

    print(find_agents.run(status="active", service="research", min_capacity=100))
    print(get_capacity.run(agent_id="agent_0002"))
    print(
        quote_contract.run(
            requester_agent_id="agent_0001",
            provider_agent_id="agent_0002",
            service="research",
            requested_capacity=100,
        )
    )


if __name__ == "__main__":
    main()
