/**
 * Reference Extractor
 *
 * Extracts references to code from any file content:
 * - Class names: PaymentController, StripeService
 * - Method names: getStripeClientSecret, handleWebhook
 * - File paths: app/Http/Controllers/PaymentController.php
 * - Route patterns: POST /api/checkout
 */

export interface ExtractedReferences {
  classNames: string[];      // PaymentController, StripeService
  methodNames: string[];     // getStripeClientSecret, handleWebhook
  filePaths: string[];       // app/Http/Controllers/...
  routePatterns: string[];   // POST /api/checkout
}

export class ReferenceExtractor {
  /**
   * Extract references from any text content
   */
  extract(content: string): ExtractedReferences {
    return {
      classNames: this.extractClassNames(content),
      methodNames: this.extractMethodNames(content),
      filePaths: this.extractFilePaths(content),
      routePatterns: this.extractRoutePatterns(content),
    };
  }

  /**
   * Extract class names from content
   * Patterns:
   * - PascalCase words ending with common suffixes (Controller, Service, Model, etc.)
   * - Explicit class references: ClassName::method(), new ClassName()
   * - PHP/Laravel patterns: ClassName::class
   */
  private extractClassNames(content: string): string[] {
    const classNames = new Set<string>();

    // Pattern 1: PascalCase names with common suffixes
    const suffixPattern = /\b([A-Z][a-zA-Z0-9]*(?:Controller|Service|Model|Repository|Factory|Handler|Provider|Middleware|Request|Resource|Event|Listener|Job|Command|Policy|Rule|Exception|Interface|Trait|Helper|Manager|Facade|Client|Gateway|Adapter|Builder|Validator|Observer|Seeder|Migration))\b/g;
    let match;
    while ((match = suffixPattern.exec(content)) !== null) {
      classNames.add(match[1]);
    }

    // Pattern 2: ClassName::method() or ClassName::class or ClassName::CONSTANT
    const staticCallPattern = /\b([A-Z][a-zA-Z0-9]+)::\w+/g;
    while ((match = staticCallPattern.exec(content)) !== null) {
      // Exclude common non-class patterns like HTTP::, API::, DB::, etc.
      const name = match[1];
      if (!this.isCommonConstant(name)) {
        classNames.add(name);
      }
    }

    // Pattern 3: new ClassName(
    const newPattern = /\bnew\s+([A-Z][a-zA-Z0-9]+)\s*\(/g;
    while ((match = newPattern.exec(content)) !== null) {
      classNames.add(match[1]);
    }

    // Pattern 4: @param ClassName, @return ClassName, @var ClassName
    const docPattern = /@(?:param|return|var|throws|type)\s+(?:\\)?([A-Z][a-zA-Z0-9]+)/g;
    while ((match = docPattern.exec(content)) !== null) {
      classNames.add(match[1]);
    }

    // Pattern 5: Use statements (use App\Models\User)
    const usePattern = /\buse\s+(?:[A-Za-z\\]+\\)?([A-Z][a-zA-Z0-9]+)(?:\s+as\s+[A-Z][a-zA-Z0-9]+)?;/g;
    while ((match = usePattern.exec(content)) !== null) {
      classNames.add(match[1]);
    }

    // Pattern 6: Markdown code references like `ClassName` or `ClassName::method()`
    const backtickPattern = /`([A-Z][a-zA-Z0-9]+)(?:::\w+)?(?:\(\))?`/g;
    while ((match = backtickPattern.exec(content)) !== null) {
      if (!this.isCommonConstant(match[1])) {
        classNames.add(match[1]);
      }
    }

    // Pattern 7: extends/implements ClassName
    const extendsPattern = /\b(?:extends|implements)\s+([A-Z][a-zA-Z0-9]+)/g;
    while ((match = extendsPattern.exec(content)) !== null) {
      classNames.add(match[1]);
    }

    return [...classNames];
  }

  /**
   * Extract method names from content
   * Patterns:
   * - methodName() calls
   * - ClassName::methodName()
   * - $object->methodName()
   * - function methodName(
   */
  private extractMethodNames(content: string): string[] {
    const methodNames = new Set<string>();

    // Pattern 1: ->methodName( or ::methodName(
    const callPattern = /(?:->|::)([a-z][a-zA-Z0-9_]*)\s*\(/g;
    let match;
    while ((match = callPattern.exec(content)) !== null) {
      const name = match[1];
      // Exclude very common methods that aren't useful for discovery
      if (!this.isCommonMethod(name) && name.length > 2) {
        methodNames.add(name);
      }
    }

    // Pattern 2: function methodName(
    const funcPattern = /\bfunction\s+([a-z][a-zA-Z0-9_]*)\s*\(/g;
    while ((match = funcPattern.exec(content)) !== null) {
      if (match[1].length > 2) {
        methodNames.add(match[1]);
      }
    }

    // Pattern 3: Markdown backtick references like `methodName()` or `ClassName::methodName()`
    const backtickMethodPattern = /`(?:[A-Z][a-zA-Z0-9]*::)?([a-z][a-zA-Z0-9_]*)\(\)`/g;
    while ((match = backtickMethodPattern.exec(content)) !== null) {
      if (!this.isCommonMethod(match[1]) && match[1].length > 2) {
        methodNames.add(match[1]);
      }
    }

    // Pattern 4: 'action' => 'methodName' (Laravel route style)
    const actionPattern = /['"]action['"]\s*=>\s*['"]([a-z][a-zA-Z0-9_]*)['"]/g;
    while ((match = actionPattern.exec(content)) !== null) {
      methodNames.add(match[1]);
    }

    // Pattern 5: [Controller::class, 'methodName']
    const arrayCallablePattern = /\[\s*[A-Z][a-zA-Z0-9]*::class\s*,\s*['"]([a-z][a-zA-Z0-9_]*)['"]\s*\]/g;
    while ((match = arrayCallablePattern.exec(content)) !== null) {
      methodNames.add(match[1]);
    }

    return [...methodNames];
  }

  /**
   * Extract file paths from content
   * Patterns:
   * - Explicit paths: app/Http/Controllers/PaymentController.php
   * - Relative paths: ./src/services/payment.ts
   * - Markdown links: [text](path/to/file.ext)
   */
  private extractFilePaths(content: string): string[] {
    const filePaths = new Set<string>();

    // Pattern 1: Common source file paths
    const pathPattern = /(?:^|[\s"'`(\[])(((?:app|src|lib|resources|routes|config|database|tests?|spec)\/[a-zA-Z0-9_\-/.]+\.[a-zA-Z]{2,5}))/gm;
    let match;
    while ((match = pathPattern.exec(content)) !== null) {
      const path = match[2];
      if (this.isValidFilePath(path)) {
        filePaths.add(path);
      }
    }

    // Pattern 2: Relative paths starting with ./
    const relativePattern = /\.\/([a-zA-Z0-9_\-/.]+\.[a-zA-Z]{2,5})/g;
    while ((match = relativePattern.exec(content)) !== null) {
      if (this.isValidFilePath(match[1])) {
        filePaths.add(match[1]);
      }
    }

    // Pattern 3: Markdown links [text](path)
    const markdownLinkPattern = /\[([^\]]*)\]\(([^)]+\.[a-zA-Z]{2,5})\)/g;
    while ((match = markdownLinkPattern.exec(content)) !== null) {
      const path = match[2];
      // Exclude URLs
      if (!path.startsWith('http') && this.isValidFilePath(path)) {
        filePaths.add(path);
      }
    }

    // Pattern 4: require/import statements with paths
    const requirePattern = /(?:require|include|include_once|require_once)\s*[('"]([^'"()]+\.[a-zA-Z]{2,5})['")\s;]/g;
    while ((match = requirePattern.exec(content)) !== null) {
      if (this.isValidFilePath(match[1])) {
        filePaths.add(match[1]);
      }
    }

    return [...filePaths];
  }

  /**
   * Extract route patterns from content
   * Patterns:
   * - HTTP methods with paths: GET /api/users, POST /checkout
   * - Route definitions: Route::get('/path', ...)
   */
  private extractRoutePatterns(content: string): string[] {
    const routePatterns = new Set<string>();

    // Pattern 1: HTTP method + path (from docs, comments)
    const httpPattern = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/[a-zA-Z0-9_\-/{}.?&=]*)/gi;
    let match;
    while ((match = httpPattern.exec(content)) !== null) {
      routePatterns.add(`${match[1].toUpperCase()} ${match[2]}`);
    }

    // Pattern 2: Laravel Route:: definitions
    const laravelRoutePattern = /Route::(get|post|put|patch|delete|options|any)\s*\(\s*['"]([^'"]+)['"]/gi;
    while ((match = laravelRoutePattern.exec(content)) !== null) {
      routePatterns.add(`${match[1].toUpperCase()} ${match[2]}`);
    }

    // Pattern 3: Express-style routes (app.get, router.post, etc.)
    const expressPattern = /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi;
    while ((match = expressPattern.exec(content)) !== null) {
      routePatterns.add(`${match[1].toUpperCase()} ${match[2]}`);
    }

    return [...routePatterns];
  }

  /**
   * Check if a name is a common constant/keyword that shouldn't be treated as a class
   */
  private isCommonConstant(name: string): boolean {
    const commonConstants = new Set([
      'HTTP', 'API', 'DB', 'URL', 'JSON', 'XML', 'HTML', 'CSS', 'SQL',
      'TRUE', 'FALSE', 'NULL', 'VOID', 'INT', 'STRING', 'BOOL', 'ARRAY',
      'ENV', 'CONFIG', 'LOG', 'DEBUG', 'ERROR', 'WARNING', 'INFO',
    ]);
    return commonConstants.has(name.toUpperCase());
  }

  /**
   * Check if a method name is too common to be useful for discovery
   */
  private isCommonMethod(name: string): boolean {
    const commonMethods = new Set([
      'get', 'set', 'has', 'is', 'to', 'from', 'add', 'remove', 'delete',
      'find', 'all', 'first', 'last', 'count', 'each', 'map', 'filter',
      'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat',
      'log', 'error', 'warn', 'info', 'debug', 'trace',
      'then', 'catch', 'finally', 'resolve', 'reject',
      'render', 'mount', 'update', 'destroy', 'init', 'create',
      'save', 'load', 'fetch', 'send', 'receive',
      'open', 'close', 'read', 'write', 'flush',
      'on', 'off', 'emit', 'trigger', 'dispatch',
      'call', 'apply', 'bind',
      'toString', 'toArray', 'toJson', 'toObject',
      'where', 'select', 'insert', 'update', 'delete',
    ]);
    return commonMethods.has(name);
  }

  /**
   * Check if a string looks like a valid file path
   */
  private isValidFilePath(path: string): boolean {
    // Must have at least one directory separator and a file extension
    if (!path.includes('/') || !path.includes('.')) {
      return false;
    }

    // Must not contain invalid characters
    if (/[<>:"|?*]/.test(path)) {
      return false;
    }

    // Must have a reasonable extension
    const ext = path.split('.').pop()?.toLowerCase();
    const validExtensions = new Set([
      'php', 'js', 'ts', 'jsx', 'tsx', 'vue', 'svelte',
      'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
      'c', 'cpp', 'h', 'hpp', 'cs',
      'html', 'css', 'scss', 'sass', 'less',
      'json', 'yaml', 'yml', 'toml', 'xml',
      'md', 'txt', 'sql', 'graphql', 'gql',
      'blade', 'twig', 'ejs', 'hbs', 'pug',
      'env', 'sh', 'bash', 'zsh',
    ]);

    return ext ? validExtensions.has(ext) : false;
  }
}
