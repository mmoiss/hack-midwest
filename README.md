# Skeg - Hack Midwest 2026
*The Captains⚓: Aruneem Bhowmick, Matthew Moisseyev, Ogochukwu Ibe-Ikechi, and Sandarika Warjri*

**Skeg is a live coordination dashboard for development teams using multiple coding agents, making shared API contracts, conflicting changes, and affected teammates visible before integration breaks.**

## Inspiration

We chose this problem because hackathons and small teams feel the pressure immediately: fast edits, limited time to coordinate, and several agents with different context. Skeg gives teams a shared contract and makes the effects of a change visible while the prompting is happening.

## Powered by AWS and Akamai

| <img src="branding/sponsors/strands-agents.png" alt="Strands Agents SDK" width="180"> | **Strands Agents: the brain of Skeg**<br>Skeg's coordinator is **a Strands agent that supervises other teams' coding agents**. Every reported edit to a contract-owning file goes through the coordinator in [`backend/coordinator.py`](backend/coordinator.py). |
|:---:|---|
| **`Agent`** | One coordinator agent per edit, given the diff, the agreed contract shape, the teammates who consume it, and any pending proposal. |
| **`@tool`** | `raise_alert` flags drift that breaks a teammate and suggests a fix. `escalate_to_human` asks for a decision on a deliberate change. The agent calls neither when the edit is clean. |
| **`BeforeToolCallEvent` / `AfterToolCallEvent`** | Hooks trace every tool call as it starts and finishes, so Skeg knows whether the agent acted or found the edit clean. |
| **`structured_output_model`** | A Pydantic `Verdict` fallback returns the same outcomes as typed output if a model's tool calling is unreliable. |
| **Swappable model providers** | One `COORDINATOR_MODEL_PROVIDER` setting switches between Akamai hosted inference (default), Amazon Bedrock, Anthropic, OpenAI, and Ollama without changing the agent. |

| <img src="branding/sponsors/akamai.svg" alt="Akamai" width="280"> | **Akamai: where Skeg lives and thinks**<br>Skeg runs entirely on Akamai Cloud, and its reasoning comes from Akamai inference, giving every teammate's agent one shared, always-on, secure hub to report to. |
|:---:|---|
| **Linode VM** | A Linode 2GB (`g6-standard-1`), set up by [`deploy/cloud-init.yaml`](deploy/cloud-init.yaml), runs the Docker Compose stack: the Python MCP and coordinator service, the Node dashboard adapter, Caddy, and SQLite storage. |
| **Cloud Firewall** | Allows inbound traffic only on ports 22, 80, and 443 and denies everything else. The backend and dashboard expose no ports; only Caddy is public. |
| **Caddy TLS on sslip.io** | Automatic HTTPS for an sslip.io hostname that points at the Linode's IP, so every MCP connection and dashboard viewer is secure with no domain purchase. |
| **Hosted inference** | The coordinator's default model is Akamai's `hackathon-chat`, called through Strands' OpenAI-compatible provider. Every contract review runs on Akamai. |



> *Skeg keeps developers smooth sailing ⛵⛵⛵⛵*