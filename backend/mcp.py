from mcp.server.fastmcp import FastMCP
import sqlite3

# Initialize the FastMCP server
mcp = FastMCP("TeamAgentCoordinator")
DB_PATH = "coordinator.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@mcp.tool()
def register_spec(service: str, endpoint: str, response_shape: str, owner: str) -> str:
    """Register or update an API contract specification so teammates know the current schema."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO specs (service, endpoint, response_shape, owner)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET response_shape = ?, owner = ?
    """, (service, endpoint, response_shape, owner, response_shape, owner))
    conn.commit()
    conn.close()
    return f"Spec successfully updated for {endpoint} by {owner}."

@mcp.tool()
def claim_region(agent_name: str, file_path: str) -> str:
    """Claim a file or directory path to signal to other agents that you are actively working on it."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO claims (agent_name, file_path, timestamp)
        VALUES (?, ?, datetime('now'))
    """, (agent_name, file_path))
    conn.commit()
    conn.close()
    return f"Success: {agent_name} has claimed {file_path}."

@mcp.tool()
def check_conflicts(file_path: str, agent_name: str) -> str:
    """Check if a file path is currently claimed by another active agent."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT agent_name FROM claims 
        WHERE file_path = ? AND agent_name != ?
    """, (file_path, agent_name))
    conflicts = cursor.fetchall()
    conn.close()

    
    if conflicts:
        names = ", ".join([row["agent_name"] for row in conflicts])
        return f"WARNING: Conflict detected! {names} is currently modifying {file_path}."
    return "No active conflicts found for this path."

if __name__ == "__main__":
    # Runs the MCP server over HTTP/stdio as configured
    mcp.run(transport="http", host="0.0.0.0", port=8000)