use crate::{model::*, parser::RawImport};
use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    time::Duration,
};

pub struct Database {
    pub connection: Connection,
    project: Option<crate::project::ProjectMap>,
    frameworks: Option<Vec<crate::frameworks::FrameworkScope>>,
}

pub struct IndexedFile {
    pub metadata: FileMetadata,
    pub content: String,
    pub terms: String,
    pub symbols: Vec<Symbol>,
    pub imports: Vec<RawImport>,
    pub references: BTreeSet<String>,
    pub generated: bool,
}

pub enum FileUpdate {
    Changed(IndexedFile),
    Metadata(FileMetadata),
    Skipped(FileMetadata),
}

impl Database {
    pub fn open(root: &Path) -> Result<Self> {
        let directory = root.join(".context");
        fs::create_dir_all(&directory)?;
        let connection = Connection::open(directory.join("index.db"))?;
        connection.busy_timeout(Duration::from_secs(10))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version != 10 {
            // The index is disposable. Source files, settings and packs are preserved.
            connection.execute_batch("BEGIN IMMEDIATE;
                DROP TABLE IF EXISTS skipped_files; DROP TABLE IF EXISTS files_fts; DROP TABLE IF EXISTS import_requests;
                DROP TABLE IF EXISTS refs; DROP TABLE IF EXISTS symbols; DROP TABLE IF EXISTS imports;
                DROP TABLE IF EXISTS git_signals; DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS state;
                CREATE TABLE files(path TEXT PRIMARY KEY, language TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL, hash TEXT NOT NULL, generated INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE skipped_files(path TEXT PRIMARY KEY, language TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL, hash TEXT NOT NULL);
                CREATE TABLE symbols(file_path TEXT REFERENCES files(path) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, start_line INTEGER, end_line INTEGER, signature TEXT, is_test INTEGER NOT NULL DEFAULT 0, is_test_case INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE import_requests(source_path TEXT REFERENCES files(path) ON DELETE CASCADE, module TEXT, kind TEXT);
                CREATE TABLE imports(source_path TEXT REFERENCES files(path) ON DELETE CASCADE, target_path TEXT REFERENCES files(path) ON DELETE CASCADE, kind TEXT NOT NULL, PRIMARY KEY(source_path,target_path,kind));
                CREATE TABLE refs(source_path TEXT REFERENCES files(path) ON DELETE CASCADE, name TEXT, PRIMARY KEY(source_path,name));
                CREATE TABLE git_signals(path TEXT PRIMARY KEY REFERENCES files(path) ON DELETE CASCADE, last_modified TEXT, commit_count INTEGER, churn_score REAL);
                CREATE TABLE state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE VIRTUAL TABLE files_fts USING fts5(path UNINDEXED, content, terms, tokenize='unicode61');
                CREATE INDEX symbols_name ON symbols(name COLLATE NOCASE);
                CREATE INDEX symbols_file ON symbols(file_path);
                CREATE INDEX imports_target ON imports(target_path);
                CREATE INDEX import_requests_source ON import_requests(source_path);
                CREATE INDEX refs_name ON refs(name);
                PRAGMA user_version=10; COMMIT;")?;
        }
        Ok(Self {
            connection,
            project: None,
            frameworks: None,
        })
    }

    pub fn set_project_map(&mut self, project: crate::project::ProjectMap) {
        self.project = Some(project);
    }

    pub fn set_framework_scopes(&mut self, scopes: Vec<crate::frameworks::FrameworkScope>) {
        self.frameworks = Some(scopes);
    }

    pub fn framework_scopes(&self) -> Result<Option<Vec<crate::frameworks::FrameworkScope>>> {
        if let Some(scopes) = &self.frameworks {
            return Ok(Some(scopes.clone()));
        }
        self.state("framework_scopes")?
            .map(|value| serde_json::from_str(&value).map_err(Into::into))
            .transpose()
    }

    pub fn generated_files(&self) -> Result<BTreeSet<String>> {
        let mut statement = self
            .connection
            .prepare_cached("SELECT path FROM files WHERE generated=1 ORDER BY path")?;
        Ok(statement
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?)
    }

    pub fn files(&self) -> Result<BTreeMap<String, FileMetadata>> {
        let mut statement = self
            .connection
            .prepare_cached("SELECT path,language,size,mtime,hash FROM files ORDER BY path")?;
        let rows = statement.query_map([], |r| {
            Ok(FileMetadata {
                path: r.get(0)?,
                language: r.get(1)?,
                size: r.get::<_, i64>(2)? as u64,
                mtime: r.get(3)?,
                hash: r.get(4)?,
            })
        })?;
        let mut files = BTreeMap::new();
        for row in rows {
            let file = row?;
            files.insert(file.path.clone(), file);
        }
        Ok(files)
    }

    pub fn skipped_files(&self) -> Result<BTreeMap<String, FileMetadata>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT path,language,size,mtime,hash FROM skipped_files ORDER BY path",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(FileMetadata {
                path: row.get(0)?,
                language: row.get(1)?,
                size: row.get::<_, i64>(2)? as u64,
                mtime: row.get(3)?,
                hash: row.get(4)?,
            })
        })?;
        let mut files = BTreeMap::new();
        for row in rows {
            let file = row?;
            files.insert(file.path.clone(), file);
        }
        Ok(files)
    }

    pub fn symbols(&self) -> Result<Vec<Symbol>> {
        let mut statement = self.connection.prepare_cached("SELECT file_path,name,kind,start_line,end_line,signature,is_test,is_test_case FROM symbols ORDER BY file_path,start_line,name")?;
        Ok(statement
            .query_map([], |r| {
                Ok(Symbol {
                    file_path: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    start_line: r.get::<_, i64>(3)? as usize,
                    end_line: r.get::<_, i64>(4)? as usize,
                    signature: r.get(5)?,
                    is_test: r.get(6)?,
                    is_test_case: r.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?)
    }

    pub fn imports(&self) -> Result<Vec<ImportRelation>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT DISTINCT source_path,target_path FROM imports ORDER BY source_path,target_path",
        )?;
        Ok(statement
            .query_map([], |r| {
                Ok(ImportRelation {
                    source_path: r.get(0)?,
                    target_path: r.get(1)?,
                    symbol: None,
                })
            })?
            .collect::<rusqlite::Result<_>>()?)
    }

    pub fn raw_imports(&self) -> Result<Vec<(String, RawImport)>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT source_path,module,kind FROM import_requests ORDER BY source_path,module",
        )?;
        Ok(statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    RawImport {
                        module: r.get(1)?,
                        kind: r.get(2)?,
                    },
                ))
            })?
            .collect::<rusqlite::Result<_>>()?)
    }

    pub fn dependencies(&self) -> Result<Vec<Dependency>> {
        let mut statement=self.connection.prepare_cached("SELECT source_path,target_path,kind FROM imports ORDER BY source_path,target_path,kind")?;
        Ok(statement
            .query_map([], |row| {
                Ok(Dependency {
                    source_path: row.get(0)?,
                    target_path: row.get(1)?,
                    kind: row.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?)
    }

    pub fn search_with_provenance(
        &self,
        terms: &[crate::terms::QueryTerm],
        limit: usize,
    ) -> Result<Vec<(String, crate::terms::Origin, f64)>> {
        use crate::terms::Origin;
        let mut groups: BTreeMap<(Origin, u32), Vec<&str>> = BTreeMap::new();
        let mut terms: Vec<_> = terms.iter().filter(|term| !term.term.is_empty()).collect();
        terms.sort_by(|a, b| {
            b.weight
                .total_cmp(&a.weight)
                .then(a.origin.cmp(&b.origin))
                .then(a.term.cmp(&b.term))
        });
        for term in terms.into_iter().take(64) {
            groups
                .entry((term.origin, (term.weight * 10000.0).round() as u32))
                .or_default()
                .push(&term.term);
        }
        let mut matches: BTreeMap<(String, Origin), f64> = BTreeMap::new();
        let mut statement=self.connection.prepare_cached("SELECT path FROM files_fts WHERE files_fts MATCH ? ORDER BY bm25(files_fts,0.0,1.0,0.6),path LIMIT ?")?;
        for ((origin, weight), terms) in groups {
            let column = match origin {
                Origin::Literal => "content",
                Origin::Stem => "terms",
                _ => "{content terms}",
            };
            let query = format!(
                "{column} : ({})",
                terms
                    .iter()
                    .filter(|term| !term.is_empty())
                    .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(" OR ")
            );
            for (rank, path) in statement
                .query_map(params![query, limit as i64], |row| row.get::<_, String>(0))?
                .enumerate()
            {
                let amount = weight as f64 / 10000.0 * 1.8 / (1.0 + rank as f64 * 0.04);
                let score = matches.entry((path?, origin)).or_default();
                *score = score.max(amount);
            }
        }
        Ok(matches
            .into_iter()
            .map(|((path, origin), score)| (path, origin, score))
            .collect())
    }

    pub fn references(&self) -> Result<BTreeMap<String, Vec<String>>> {
        let mut statement = self
            .connection
            .prepare_cached("SELECT source_path,name FROM refs ORDER BY source_path,name")?;
        let mut result: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for row in
            statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        {
            let (source, name) = row?;
            result.entry(source).or_default().push(name);
        }
        Ok(result)
    }

    pub fn search(&self, words: &[String], limit: usize) -> Result<Vec<(String, f64)>> {
        if words.is_empty() {
            return Ok(vec![]);
        }
        let query = words
            .iter()
            .filter(|w| !w.is_empty())
            .take(64)
            .map(|w| format!("\"{}\"", w.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" OR ");
        if query.is_empty() {
            return Ok(vec![]);
        }
        let mut statement = self.connection.prepare_cached("SELECT path,bm25(files_fts) FROM files_fts WHERE files_fts MATCH ? ORDER BY bm25(files_fts),path LIMIT ?")?;
        Ok(statement
            .query_map(params![query, limit as i64], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?)
    }

    pub fn state(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .connection
            .query_row("SELECT value FROM state WHERE key=?", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn update(
        &mut self,
        changes: impl IntoIterator<Item = Result<FileUpdate>>,
        removed: &[String],
        git: Option<&[GitSignal]>,
        git_key: Option<&str>,
        aliases: &[(String, String)],
    ) -> Result<(usize, usize)> {
        let project_key = serde_json::to_string(&self.project)?;
        let transaction = self.connection.transaction()?;
        let mut updated = 0;
        let mut removed_count = 0;
        {
            let mut delete_fts = transaction.prepare_cached(
                "DELETE FROM files_fts WHERE rowid=(SELECT rowid FROM files WHERE path=?)",
            )?;
            let mut delete_file = transaction.prepare_cached("DELETE FROM files WHERE path=?")?;
            for path in removed {
                delete_fts.execute([path])?;
                removed_count += delete_file.execute([path])?;
                transaction.execute("DELETE FROM skipped_files WHERE path=?", [path])?;
            }
            let mut upsert = transaction.prepare_cached("INSERT INTO files(path,language,size,mtime,hash) VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET language=excluded.language,size=excluded.size,mtime=excluded.mtime,hash=excluded.hash")?;
            let mut quality_update =
                transaction.prepare_cached("UPDATE files SET generated=? WHERE path=?")?;
            let mut symbol_insert =
                transaction.prepare_cached("INSERT INTO symbols VALUES(?,?,?,?,?,?,?,?)")?;
            let mut request_insert =
                transaction.prepare_cached("INSERT INTO import_requests VALUES(?,?,?)")?;
            let mut reference_insert =
                transaction.prepare_cached("INSERT OR IGNORE INTO refs VALUES(?,?)")?;
            let mut content_insert =
                transaction.prepare_cached("INSERT INTO files_fts(rowid,path,content,terms) VALUES((SELECT rowid FROM files WHERE path=?1),?1,?2,?3)")?;
            for change in changes {
                let change = change?;
                let file = match change {
                    FileUpdate::Skipped(metadata) => {
                        delete_fts.execute([&metadata.path])?;
                        removed_count += delete_file.execute([&metadata.path])?;
                        transaction.execute(
                            "INSERT OR REPLACE INTO skipped_files VALUES(?,?,?,?,?)",
                            params![
                                metadata.path,
                                metadata.language,
                                i64::try_from(metadata.size)?,
                                metadata.mtime,
                                metadata.hash
                            ],
                        )?;
                        continue;
                    }
                    FileUpdate::Metadata(metadata) => {
                        upsert.execute(params![
                            metadata.path,
                            metadata.language,
                            i64::try_from(metadata.size)?,
                            metadata.mtime,
                            metadata.hash
                        ])?;
                        continue;
                    }
                    FileUpdate::Changed(file) => file,
                };
                updated += 1;
                let f = &file.metadata;
                transaction.execute("DELETE FROM skipped_files WHERE path=?", [&f.path])?;
                upsert.execute(params![
                    f.path,
                    f.language,
                    i64::try_from(f.size)?,
                    f.mtime,
                    f.hash
                ])?;
                quality_update.execute(params![file.generated, f.path])?;
                for table in ["symbols", "import_requests", "refs"] {
                    let column = if table == "symbols" {
                        "file_path"
                    } else {
                        "source_path"
                    };
                    transaction
                        .execute(&format!("DELETE FROM {table} WHERE {column}=?"), [&f.path])?;
                }
                for s in &file.symbols {
                    symbol_insert.execute(params![
                        s.file_path,
                        s.name,
                        s.kind,
                        i64::try_from(s.start_line)?,
                        i64::try_from(s.end_line)?,
                        s.signature,
                        s.is_test,
                        s.is_test_case
                    ])?;
                }
                for r in &file.imports {
                    request_insert.execute(params![f.path, r.module, r.kind])?;
                }
                for name in &file.references {
                    reference_insert.execute(params![f.path, name])?;
                }
                delete_fts.execute([&f.path])?;
                content_insert.execute(params![f.path, file.content, file.terms])?;
            }
        }
        let previous_project: Option<String> = transaction
            .query_row("SELECT value FROM state WHERE key='project_map'", [], |r| {
                r.get(0)
            })
            .optional()?;
        if updated > 0
            || removed_count > 0
            || self_aliases_changed(&transaction, aliases)?
            || previous_project.as_ref() != Some(&project_key)
        {
            transaction.execute("DELETE FROM imports", [])?;
            let files = {
                let mut statement = transaction.prepare("SELECT path FROM files")?;
                statement
                    .query_map([], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<std::collections::HashSet<_>>>()?
            };
            let requests = {
                let mut statement =
                    transaction.prepare("SELECT source_path,module,kind FROM import_requests")?;
                statement
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            RawImport {
                                module: r.get(1)?,
                                kind: r.get(2)?,
                            },
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            if let Some(project) = self.project.as_mut() {
                project.prepare_files(&files);
            }
            let java = crate::java::ImportIndex::new(&files);
            let mut statement =
                transaction.prepare_cached("INSERT OR IGNORE INTO imports VALUES(?,?,?)")?;
            for (source, request) in requests {
                let targets = if request.kind == "java" {
                    java.resolve(&request.module)
                } else {
                    self.project
                        .as_ref()
                        .and_then(|p| p.resolve(&source, &request, &files))
                        .unwrap_or_else(|| {
                            crate::parser::resolve_import(&source, &request, &files, aliases)
                        })
                };
                for target in targets {
                    statement.execute(params![source, target, request.kind])?;
                }
            }
        }
        if let Some(git) = git {
            transaction.execute("DELETE FROM git_signals", [])?;
            let mut statement =
                transaction.prepare_cached("INSERT INTO git_signals SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM files WHERE path=?1)")?;
            for signal in git {
                statement.execute(params![
                    signal.path,
                    signal.last_modified,
                    i64::try_from(signal.commit_count)?,
                    signal.churn_score
                ])?;
            }
        }
        if let Some(key) = git_key {
            transaction.execute("INSERT OR REPLACE INTO state VALUES('git_key',?)", [key])?;
        }
        transaction.execute(
            "INSERT OR REPLACE INTO state VALUES('aliases',?)",
            [serde_json::to_string(aliases)?],
        )?;
        transaction.execute(
            "INSERT OR REPLACE INTO state VALUES('project_map',?)",
            [&project_key],
        )?;
        if let Some(scopes) = &self.frameworks {
            transaction.execute(
                "INSERT OR REPLACE INTO state VALUES('framework_scopes',?)",
                [serde_json::to_string(scopes)?],
            )?;
        }
        transaction.commit().context("Cannot commit index update")?;
        Ok((updated, removed_count))
    }

    pub fn counts(&self) -> Result<(usize, usize, usize)> {
        Ok(self.connection.query_row("SELECT (SELECT count(*) FROM files),(SELECT count(*) FROM symbols),(SELECT count(*) FROM (SELECT DISTINCT source_path,target_path FROM imports))",[],|row|Ok((row.get::<_,i64>(0)? as usize,row.get::<_,i64>(1)? as usize,row.get::<_,i64>(2)? as usize)))?)
    }

    pub fn git_signals(&self) -> Result<BTreeMap<String, GitSignal>> {
        let mut statement = self.connection.prepare_cached(
            "SELECT path,last_modified,commit_count,churn_score FROM git_signals ORDER BY path",
        )?;
        let mut result = BTreeMap::new();
        for row in statement.query_map([], |r| {
            Ok(GitSignal {
                path: r.get(0)?,
                last_modified: r.get(1)?,
                commit_count: r.get::<_, i64>(2)? as u64,
                churn_score: r.get(3)?,
            })
        })? {
            let signal = row?;
            result.insert(signal.path.clone(), signal);
        }
        Ok(result)
    }
}

fn self_aliases_changed(connection: &Connection, aliases: &[(String, String)]) -> Result<bool> {
    let old: Option<String> = connection
        .query_row("SELECT value FROM state WHERE key='aliases'", [], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(old.as_deref() != Some(serde_json::to_string(aliases)?.as_str()))
}
