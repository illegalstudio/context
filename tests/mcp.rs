use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::Duration,
};

struct Client {
    child: Child,
    input: ChildStdin,
    output: Receiver<String>,
    next: u64,
}
impl Client {
    fn start(root: &std::path::Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_context"))
            .arg("--root")
            .arg(root)
            .arg("mcp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (sender, output) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if sender.send(line.unwrap()).is_err() {
                    break;
                }
            }
        });
        let mut client = Self {
            child,
            input,
            output,
            next: 1,
        };
        let response=client.request("initialize",json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"context-tests","version":"1"}}));
        assert!(
            response["result"]["capabilities"]["tools"].is_object(),
            "{response}"
        );
        client.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
        client
    }
    fn send(&mut self, value: Value) {
        writeln!(self.input, "{value}").unwrap();
        self.input.flush().unwrap();
    }
    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next;
        self.next += 1;
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}));
        loop {
            let line = self
                .output
                .recv_timeout(Duration::from_secs(20))
                .expect("MCP response timed out");
            let value: Value = serde_json::from_str(&line)
                .expect("MCP stdout must contain only JSON-RPC messages");
            if value["id"] == id {
                return value;
            }
        }
    }
    fn tool(&mut self, name: &str, args: Value) -> Value {
        let response = self.request("tools/call", json!({"name":name,"arguments":args}));
        assert_ne!(response["result"]["isError"], true, "{response}");
        serde_json::from_str(
            response["result"]["content"][0]["text"]
                .as_str()
                .expect("Expected text tool result"),
        )
        .unwrap()
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn official_sdk_serves_search_explain_packs_resources_and_validation_over_stdio() {
    let directory = tempfile::Builder::new()
        .prefix("context-mcp-")
        .tempdir()
        .unwrap();
    fs::write(
        directory.path().join("payment.ts"),
        "export function processPayment() { return true; }",
    )
    .unwrap();
    let mut client = Client::start(directory.path());
    let response = client.request("tools/list", json!({}));
    for name in [
        "context_search",
        "context_explain",
        "context_pack",
        "context_list",
        "context_read_pack",
    ] {
        assert!(
            response["result"]["tools"]
                .as_array()
                .unwrap()
                .iter()
                .any(|tool| tool["name"] == name),
            "{response}"
        );
    }
    let result = client.tool(
        "context_search",
        json!({"query":"processPayment","limit":5}),
    );
    assert_eq!(result["hits"][0]["path"], "payment.ts");
    let result = client.tool(
        "context_explain",
        json!({"task":"Fix processPayment","path":"payment.ts"}),
    );
    assert_eq!(result["selected"], true);
    let result = client.tool(
        "context_pack",
        json!({"task":"Fix processPayment","budget_tokens":1000,"tokenizer":"cl100k_base"}),
    );
    let slug = result["manifest"]["slug"].as_str().unwrap().to_owned();
    assert!(result["prompt"].as_str().unwrap().contains("return true;"));
    let resources = client.request("resources/list", json!({}));
    let uri = resources["result"]["resources"][0]["uri"].as_str().unwrap();
    assert!(uri.ends_with(&slug));
    let read = client.request("resources/read", json!({"uri":uri}));
    assert!(
        read["result"]["contents"][0]["text"]
            .as_str()
            .unwrap()
            .contains("processPayment")
    );
    let result = client.tool("context_pack", json!({"update":slug}));
    assert_eq!(result["manifest"]["tokenizer"], "cl100k_base");
    assert!(
        result["manifest"]["changes"]["changed"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let invalid = client.request(
        "tools/call",
        json!({"name":"context_search","arguments":{"query":"payment","limit":1000000}}),
    );
    assert_eq!(invalid["result"]["isError"], true);
    let invalid = client.request(
        "tools/call",
        json!({"name":"context_read_pack","arguments":{"slug":"../../outside"}}),
    );
    assert_eq!(invalid["result"]["isError"], true);
    let invalid = client.request(
        "tools/call",
        json!({"name":"context_pack","arguments":{"task":"x","root":"/"}}),
    );
    assert!(invalid.get("error").is_some() || invalid["result"]["isError"] == true);
    assert_eq!(client.request("ping", json!({}))["result"], json!({}));
}
