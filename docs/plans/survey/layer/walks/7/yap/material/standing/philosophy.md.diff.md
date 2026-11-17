# philosophy.md: diff from 7d29890 (parent of 0538d1c) to 72395ae

```diff
diff --git a/philosophy.md b/philosophy.md
index 2cb356c..4049ff9 100644
--- a/philosophy.md
+++ b/philosophy.md
@@ -28,6 +28,8 @@ If a feature request would turn yap into any of those, the answer is no — even
 
 **Clients do the interesting work.** Agent brains, tool use, memory beyond the buffer, orchestration logic — all of it lives in clients. The server is a broker and nothing more.
 
+**Runtimes live out-of-tree.** yap does not bundle an agent runtime. Authors write against the HTTP or MCP surface, or pick a ready-made agent from [yap-agents](https://github.com/jkershaw/yap-agents). This is load-bearing: bundling a runtime in-tree biases the project toward one agent shape (typically LLM + system prompt + JSON config) and turns feature requests into framework drift. Keeping runtimes out is how yap stays a broker while still having a lively ecosystem above it.
+
 ## Things we will not add
 
 - Persistent message storage
```
