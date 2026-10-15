use crate::{discovery, model::PackOptions, pack, query, resolver};
use anyhow::Result;
use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::*,
    schemars,
    service::RequestContext,
    tool, tool_handler, tool_router,
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct ContextServer {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
    tool_router: ToolRouter<Self>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SearchArgs {
    /// Task, symbol name, filename or search words.
    query: String,
    /// Maximum results, between 1 and 100.
    limit: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExplainArgs {
    task: String,
    path: String,
    max_files: Option<usize>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PackArgs {
    task: Option<String>,
    budget_tokens: Option<usize>,
    max_files: Option<usize>,
    /// approx, cl100k_base or o200k_base. Vocabularies are embedded and offline.
    tokenizer: Option<String>,
    /// Existing pack slug or latest. Emit changed context relative to this pack.
    update: Option<String>,
}

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ReadPackArgs {
    slug: String,
}

fn limit(value: usize, maximum: usize, name: &str) -> anyhow::Result<usize> {
    anyhow::ensure!(
        (1..=maximum).contains(&value),
        "{name} must be between 1 and {maximum}"
    );
    Ok(value)
}

impl ContextServer {
    pub fn new(root: &Path) -> Result<Self> {
        Ok(Self {
            root: root.canonicalize()?,
            gate: Arc::new(Mutex::new(())),
            tool_router: Self::tool_router(),
        })
    }

    async fn operation<F, T>(&self, operation: F) -> std::result::Result<CallToolResult, McpError>
    where
        F: FnOnce(&Path) -> Result<T> + Send + 'static,
        T: Serialize + Send + 'static,
    {
        let root = self.root.clone();
        let gate = self.gate.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<String> {
            let _guard = gate
                .lock()
                .map_err(|_| anyhow::anyhow!("Project operation lock failed"))?;
            serde_json::to_string(&operation(&root)?).map_err(Into::into)
        })
        .await
        .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        Ok(match result {
            Ok(text) => CallToolResult::success(vec![ContentBlock::text(text)]),
            Err(error) => CallToolResult::error(vec![ContentBlock::text(format!("{error:#}"))]),
        })
    }
}

#[tool_router]
impl ContextServer {
    #[tool(
        description = "Search indexed source code and return ranked files, symbols, explanations and focused excerpts. Refreshes the local index."
    )]
    async fn context_search(
        &self,
        Parameters(args): Parameters<SearchArgs>,
    ) -> std::result::Result<CallToolResult, McpError> {
        self.operation(move |root| {
            let count = limit(args.limit.unwrap_or(10), 100, "limit")?;
            let (config, database) = query::prepare(root, false)?;
            query::search(root, &database, &config, &args.query, count)
        })
        .await
    }

    #[tool(
        description = "Explain why a project-relative file is selected or omitted for a task, including score contributions and dependency relationships."
    )]
    async fn context_explain(
        &self,
        Parameters(args): Parameters<ExplainArgs>,
    ) -> std::result::Result<CallToolResult, McpError> {
        self.operation(move |root| {
            let (config, database) = query::prepare(root, false)?;
            let options = PackOptions {
                task: Some(args.task),
                max_files: limit(
                    args.max_files.unwrap_or(config.max_files),
                    1000,
                    "max_files",
                )?,
                ..Default::default()
            };
            query::explain(root, &database, &config, &args.path, &options)
        })
        .await
    }

    #[tool(
        description = "Create a bounded context pack, or an incremental update of an existing pack. Writes only Context configuration/index and pack artifacts in the configured project."
    )]
    async fn context_pack(
        &self,
        Parameters(args): Parameters<PackArgs>,
    ) -> std::result::Result<CallToolResult, McpError> {
        self.operation(move |root| {
            let (mut config,database)=query::prepare(root,args.update.is_some())?;
            let parent=args.update.as_deref().map(|slug|pack::load(root,slug)).transpose()?;
            config.tokenizer=args.tokenizer.or_else(||parent.as_ref().map(|(_,m)|m.tokenizer.clone())).unwrap_or(config.tokenizer);
            crate::tokens::Tokenizer::validate(&config.tokenizer)?;
            let mut options=parent.as_ref().and_then(|(_,m)|m.options.clone()).unwrap_or_else(||PackOptions {
                max_files:config.max_files,budget_tokens:config.budget_tokens,..Default::default()
            });
            // MCP inputs do not permit reading arbitrary error-log paths from old CLI options.
            options.error=None; options.since=None;
            if let Some(task)=args.task { options.task=Some(task); }
            if options.task.is_none() { options.task=parent.as_ref().map(|(_,m)|m.task.raw.clone()); }
            anyhow::ensure!(options.task.is_some(),"task is required when creating a new pack");
            options.max_files=limit(args.max_files.unwrap_or_else(||parent.as_ref().map_or(config.max_files,|_|options.max_files)),1000,"max_files")?;
            options.budget_tokens=limit(args.budget_tokens.unwrap_or_else(||parent.as_ref().map_or(config.budget_tokens,|_|options.budget_tokens)),1_000_000,"budget_tokens")?;
            let resolution=resolver::resolve(root,&options)?;
            let candidates=discovery::discover(root,&database,&resolution,&options,config.graph_depth)?;
            let result=pack::compose_with_options(root,&database,&resolution,&candidates,&config,&options,parent.as_ref().map(|(_,m)|m))?;
            Ok(serde_json::json!({"manifest":result.manifest,"prompt":pack::read_prompt(root,&result.directory)?}))
        }).await
    }

    #[tool(
        description = "List saved context packs and their parent relationships. Does not refresh the index."
    )]
    async fn context_list(&self) -> std::result::Result<CallToolResult, McpError> {
        self.operation(|root| {
            Ok(pack::list(root)?
                .into_iter()
                .take(100)
                .map(|(_, m)| m)
                .collect::<Vec<_>>())
        })
        .await
    }

    #[tool(
        description = "Read the complete PACK.md prompt of a saved context pack using its slug, unique prefix or latest."
    )]
    async fn context_read_pack(
        &self,
        Parameters(args): Parameters<ReadPackArgs>,
    ) -> std::result::Result<CallToolResult, McpError> {
        self.operation(move |root| {
            let (directory,manifest)=pack::load(root,&args.slug)?;
            Ok(serde_json::json!({"manifest":manifest,"prompt":pack::read_prompt(root,&directory)?}))
        }).await
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for ContextServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().enable_resources().build())
            .with_server_info(Implementation::from_build_env())
            .with_instructions("Search and explain code before requesting a pack. The project root is fixed by the server command. Use incremental updates only after retaining the parent pack context.".to_string())
    }

    async fn list_resources(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> std::result::Result<ListResourcesResult, McpError> {
        let root = self.root.clone();
        let resources = tokio::task::spawn_blocking(move || -> Result<Vec<Resource>> {
            Ok(pack::list(&root)?
                .into_iter()
                .take(100)
                .map(|(_, m)| Resource::new(format!("context://packs/{}", m.slug), m.slug))
                .collect())
        })
        .await
        .map_err(|e| McpError::internal_error(e.to_string(), None))?
        .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        Ok(ListResourcesResult {
            resources,
            ..Default::default()
        })
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _: RequestContext<RoleServer>,
    ) -> std::result::Result<ReadResourceResponse, McpError> {
        let uri = request.uri;
        let slug = uri
            .strip_prefix("context://packs/")
            .ok_or_else(|| McpError::resource_not_found("Unknown pack resource", None))?
            .to_owned();
        let root = self.root.clone();
        let text = tokio::task::spawn_blocking(move || -> Result<String> {
            let (directory, _) = pack::load(&root, &slug)?;
            pack::read_prompt(&root, &directory)
        })
        .await
        .map_err(|e| McpError::internal_error(e.to_string(), None))?
        .map_err(|e| McpError::resource_not_found(e.to_string(), None))?;
        Ok(ReadResourceResult::new(vec![ResourceContents::text(text, uri)]).into())
    }
}

pub fn run(root: &Path) -> Result<()> {
    let server = ContextServer::new(root)?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(async move {
            server
                .serve(rmcp::transport::stdio())
                .await?
                .waiting()
                .await?;
            anyhow::Ok(())
        })
}
