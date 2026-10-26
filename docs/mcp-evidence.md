# Read-only MCP evidence integration

Campaign grounding uses a real local subprocess boundary: `evidence-mcp-client.mjs` starts `evidence-mcp-server.mjs` and exchanges UTF-8 newline-delimited JSON-RPC over stdin/stdout. The implementation pins MCP protocol version **2025-11-25**, performs `initialize`, `notifications/initialized`, and `tools/list`, then invokes `tools/call`. It supports ping, cancellation notifications, bounded errors and shutdown. It is a small implementation of this protocol surface, not an SDK or a claim of implementing every optional MCP feature.

This follows the official [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) and [tool contracts](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

## Tools

- `search_evidence(query, filters, limit)` searches either the shared synthetic brand corpus or official trail dossiers. `filters.layer` is required; trail IDs and walking/cycling filters are optional for trails. Results are bounded to ten. Explicit selected trail IDs are lookups, not a popularity ranking. Brand retrieval reuses the existing `knowledge.mjs` lexical TF-IDF retrieval; no replacement vector store is introduced.
- `fetch_source(source_id)` reads an exact canonical trail dossier or a `brand:`-prefixed source from the existing brand corpus. It returns content hashes/corpus version, source text and provenance. It does not accept file paths.

Returned transport metadata identifies the actual tool, JSON-RPC request ID, protocol version, stdio transport and observed elapsed milliseconds. Source excerpts remain untrusted data. They cannot invoke tools, choose paths, change owners, set approval or grant API consent.

## Capability and resource limits

Only the repository's shared public demo corpora are exposed. Checkpoints, private indexes, credentials and environment files are not tools or resources. The process has a fixed entry point and receives only a minimal OS/path environment; provider keys, `NODE_OPTIONS`, home directories and proxy settings are not forwarded. No network requests occur in these tools. There is no HTTP MCP listener, credential creation, persistent external access, sampling or publishing capability.

The client limits requests to five seconds and sends cancellation on timeout or workflow stop. Request messages are limited to 64 KiB and responses to 768 KiB. Tool errors are sanitized. Closing the service closes stdin and terminates a child that does not exit promptly. A child crash rejects its current requests without replay; after the old process exits, the next explicitly requested operation starts a fresh handshake. Old process events cannot change the new connection. No automatic retry silently repeats a failed or timed-out operation. Private-source authorization is deliberately unsupported; a shared-server deployment would need a separate identity/ACL design.

## Verification

`node --test tests/evidence-mcp.test.mjs` exercises a real subprocess handshake, discovery, trail and brand searches, exact source fetch, versions and provenance. Further tests cover forbidden path/owner/filter inputs, absent tools, malformed messages, capability restriction, minimal child environment, pre-initialization rejection, cancellation of late results and sanitized errors. These are real local MCP transport tests, with no provider API or vector-search calls. Pinecone is retained in the existing Ask integration and is not used by this local evidence path.
