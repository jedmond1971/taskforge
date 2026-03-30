export type ASTNode = ComparisonNode | LogicalNode | GroupNode;

export interface ComparisonNode {
  type: "comparison";
  field: string;
  operator: Operator;
  value: ValueNode;
}

export interface LogicalNode {
  type: "logical";
  operator: "AND" | "OR";
  left: ASTNode;
  right: ASTNode;
}

export interface GroupNode {
  type: "group";
  expression: ASTNode;
}

export type Operator =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "~"
  | "IN"
  | "NOT IN";

export type ValueNode =
  | { type: "string"; value: string }
  | { type: "function"; name: string }
  | { type: "empty" }
  | { type: "list"; values: ValueNode[] };

export interface OrderByClause {
  field: string;
  direction: "ASC" | "DESC";
}

export interface ParseResult {
  where: ASTNode | null;
  orderBy: OrderByClause[];
}

export class ParseError extends Error {
  position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = "ParseError";
    this.position = position;
  }
}

// --- Tokenizer ---

type TokenType =
  | "IDENTIFIER"
  | "STRING"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "EQ"
  | "NEQ"
  | "GT"
  | "LT"
  | "GTE"
  | "LTE"
  | "TILDE"
  | "AND"
  | "OR"
  | "IN"
  | "NOT"
  | "ORDER"
  | "BY"
  | "ASC"
  | "DESC"
  | "EMPTY"
  | "EOF";

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const KNOWN_FIELDS = new Set([
  "status",
  "priority",
  "type",
  "assignee",
  "reporter",
  "project",
  "title",
  "description",
  "labels",
  "createdat",
  "updatedat",
  "key",
]);

const FIELD_CANONICAL: Record<string, string> = {
  status: "status",
  priority: "priority",
  type: "type",
  assignee: "assignee",
  reporter: "reporter",
  project: "project",
  title: "title",
  description: "description",
  labels: "labels",
  createdat: "createdAt",
  updatedat: "updatedAt",
  key: "key",
};

const KEYWORDS: Record<string, TokenType> = {
  and: "AND",
  or: "OR",
  in: "IN",
  not: "NOT",
  order: "ORDER",
  by: "BY",
  asc: "ASC",
  desc: "DESC",
  empty: "EMPTY",
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    const pos = i;

    // String literal
    if (input[i] === '"') {
      i++;
      let str = "";
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < input.length) {
          i++;
          str += input[i];
        } else {
          str += input[i];
        }
        i++;
      }
      if (i >= input.length) {
        throw new ParseError("Unclosed string literal", pos);
      }
      i++; // skip closing quote
      tokens.push({ type: "STRING", value: str, position: pos });
      continue;
    }

    // Operators
    if (input[i] === "(" ) { tokens.push({ type: "LPAREN", value: "(", position: pos }); i++; continue; }
    if (input[i] === ")" ) { tokens.push({ type: "RPAREN", value: ")", position: pos }); i++; continue; }
    if (input[i] === "," ) { tokens.push({ type: "COMMA", value: ",", position: pos }); i++; continue; }
    if (input[i] === "~" ) { tokens.push({ type: "TILDE", value: "~", position: pos }); i++; continue; }
    if (input[i] === "!" && i + 1 < input.length && input[i + 1] === "=") {
      tokens.push({ type: "NEQ", value: "!=", position: pos }); i += 2; continue;
    }
    if (input[i] === ">" && i + 1 < input.length && input[i + 1] === "=") {
      tokens.push({ type: "GTE", value: ">=", position: pos }); i += 2; continue;
    }
    if (input[i] === "<" && i + 1 < input.length && input[i + 1] === "=") {
      tokens.push({ type: "LTE", value: "<=", position: pos }); i += 2; continue;
    }
    if (input[i] === ">" ) { tokens.push({ type: "GT", value: ">", position: pos }); i++; continue; }
    if (input[i] === "<" ) { tokens.push({ type: "LT", value: "<", position: pos }); i++; continue; }
    if (input[i] === "=" ) { tokens.push({ type: "EQ", value: "=", position: pos }); i++; continue; }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(input[i])) {
      let ident = "";
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        ident += input[i];
        i++;
      }
      const lower = ident.toLowerCase();
      if (lower in KEYWORDS) {
        tokens.push({ type: KEYWORDS[lower], value: ident, position: pos });
      } else {
        tokens.push({ type: "IDENTIFIER", value: ident, position: pos });
      }
      continue;
    }

    throw new ParseError(`Unexpected character: '${input[i]}'`, pos);
  }

  tokens.push({ type: "EOF", value: "", position: i });
  return tokens;
}

// --- Parser ---

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private current(): Token {
    return this.tokens[this.pos];
  }

  private peek(offset = 0): Token {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) return this.tokens[this.tokens.length - 1];
    return this.tokens[idx];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new ParseError(
        `Expected ${type} but got ${token.type} ('${token.value}')`,
        token.position
      );
    }
    return this.advance();
  }

  parse(): ParseResult {
    if (this.current().type === "EOF") {
      return { where: null, orderBy: [] };
    }

    // Check if query starts with ORDER BY (no where clause)
    if (
      this.current().type === "ORDER" &&
      this.peek(1).type === "BY"
    ) {
      const orderBy = this.parseOrderBy();
      this.expect("EOF");
      return { where: null, orderBy };
    }

    const where = this.parseExpression();

    let orderBy: OrderByClause[] = [];
    if (
      this.current().type === "ORDER" &&
      this.peek(1).type === "BY"
    ) {
      orderBy = this.parseOrderBy();
    }

    this.expect("EOF");
    return { where, orderBy };
  }

  private parseExpression(): ASTNode {
    return this.parseOrExpr();
  }

  private parseOrExpr(): ASTNode {
    let left = this.parseAndExpr();

    while (this.current().type === "OR") {
      this.advance();
      const right = this.parseAndExpr();
      left = { type: "logical", operator: "OR", left, right };
    }

    return left;
  }

  private parseAndExpr(): ASTNode {
    let left = this.parsePrimary();

    while (this.current().type === "AND") {
      this.advance();
      const right = this.parsePrimary();
      left = { type: "logical", operator: "AND", left, right };
    }

    return left;
  }

  private parsePrimary(): ASTNode {
    if (this.current().type === "LPAREN") {
      this.advance();
      const expr = this.parseExpression();
      this.expect("RPAREN");
      return { type: "group", expression: expr };
    }

    return this.parseComparison();
  }

  private parseComparison(): ComparisonNode {
    const fieldToken = this.current();
    if (fieldToken.type !== "IDENTIFIER") {
      throw new ParseError(
        `Expected field name but got ${fieldToken.type} ('${fieldToken.value}')`,
        fieldToken.position
      );
    }
    this.advance();

    const fieldLower = fieldToken.value.toLowerCase();
    if (!KNOWN_FIELDS.has(fieldLower)) {
      throw new ParseError(
        `Unknown field: '${fieldToken.value}'`,
        fieldToken.position
      );
    }
    const field = FIELD_CANONICAL[fieldLower];

    const operator = this.parseOperator();
    const value = this.parseValue(operator);

    return { type: "comparison", field, operator, value };
  }

  private parseOperator(): Operator {
    const token = this.current();

    switch (token.type) {
      case "EQ":
        this.advance();
        return "=";
      case "NEQ":
        this.advance();
        return "!=";
      case "GT":
        this.advance();
        return ">";
      case "LT":
        this.advance();
        return "<";
      case "GTE":
        this.advance();
        return ">=";
      case "LTE":
        this.advance();
        return "<=";
      case "TILDE":
        this.advance();
        return "~";
      case "IN":
        this.advance();
        return "IN";
      case "NOT":
        this.advance();
        this.expect("IN");
        return "NOT IN";
      default:
        throw new ParseError(
          `Expected operator but got ${token.type} ('${token.value}')`,
          token.position
        );
    }
  }

  private parseValue(operator: Operator): ValueNode {
    const token = this.current();

    // List value for IN / NOT IN
    if (operator === "IN" || operator === "NOT IN") {
      if (token.type === "LPAREN") {
        return this.parseValueList();
      }
      throw new ParseError(
        `Expected '(' for value list after ${operator}`,
        token.position
      );
    }

    // EMPTY
    if (token.type === "EMPTY") {
      this.advance();
      return { type: "empty" };
    }

    // String literal
    if (token.type === "STRING") {
      this.advance();
      return { type: "string", value: token.value };
    }

    // Function call or bare identifier
    if (token.type === "IDENTIFIER") {
      // Check if it's a function call: identifier followed by ()
      if (this.peek(1).type === "LPAREN" && this.peek(2).type === "RPAREN") {
        const name = token.value;
        this.advance(); // identifier
        this.advance(); // (
        this.advance(); // )
        return { type: "function", name };
      }
      throw new ParseError(
        `Expected a quoted string value, got unquoted identifier '${token.value}'. Did you forget quotes?`,
        token.position
      );
    }

    throw new ParseError(
      `Expected value but got ${token.type} ('${token.value}')`,
      token.position
    );
  }

  private parseValueList(): ValueNode {
    this.expect("LPAREN");
    const values: ValueNode[] = [];

    // Parse first value
    values.push(this.parseSingleValue());

    while (this.current().type === "COMMA") {
      this.advance();
      values.push(this.parseSingleValue());
    }

    this.expect("RPAREN");
    return { type: "list", values };
  }

  private parseSingleValue(): ValueNode {
    const token = this.current();

    if (token.type === "EMPTY") {
      this.advance();
      return { type: "empty" };
    }

    if (token.type === "STRING") {
      this.advance();
      return { type: "string", value: token.value };
    }

    if (token.type === "IDENTIFIER") {
      if (this.peek(1).type === "LPAREN" && this.peek(2).type === "RPAREN") {
        const name = token.value;
        this.advance();
        this.advance();
        this.advance();
        return { type: "function", name };
      }
      throw new ParseError(
        `Expected a quoted string value, got unquoted identifier '${token.value}'`,
        token.position
      );
    }

    throw new ParseError(
      `Expected value but got ${token.type} ('${token.value}')`,
      token.position
    );
  }

  private parseOrderBy(): OrderByClause[] {
    this.expect("ORDER");
    this.expect("BY");

    const clauses: OrderByClause[] = [];
    clauses.push(this.parseOrderItem());

    while (this.current().type === "COMMA") {
      this.advance();
      clauses.push(this.parseOrderItem());
    }

    return clauses;
  }

  private parseOrderItem(): OrderByClause {
    const fieldToken = this.current();
    if (fieldToken.type !== "IDENTIFIER") {
      throw new ParseError(
        `Expected field name in ORDER BY but got ${fieldToken.type} ('${fieldToken.value}')`,
        fieldToken.position
      );
    }
    this.advance();

    const fieldLower = fieldToken.value.toLowerCase();
    if (!KNOWN_FIELDS.has(fieldLower)) {
      throw new ParseError(
        `Unknown field in ORDER BY: '${fieldToken.value}'`,
        fieldToken.position
      );
    }
    const field = FIELD_CANONICAL[fieldLower];

    let direction: "ASC" | "DESC" = "ASC";
    if (this.current().type === "ASC") {
      this.advance();
      direction = "ASC";
    } else if (this.current().type === "DESC") {
      this.advance();
      direction = "DESC";
    }

    return { field, direction };
  }
}

export function parse(query: string): ParseResult {
  const trimmed = query.trim();
  if (trimmed === "") {
    return { where: null, orderBy: [] };
  }

  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens);
  return parser.parse();
}
