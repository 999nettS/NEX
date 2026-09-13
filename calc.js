// calc.js — a small, self-contained arithmetic parser/evaluator.
// Deliberately does NOT use Function(...), eval, or new Function — the
// grammar below only understands numbers, + - * / % ^, parentheses, and
// unary +/-, so there is no code-execution surface at all, regardless of
// what string is fed in.

class CalcError extends Error {}

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= "0" && c <= "9";
  while (i < input.length) {
    const c = input[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (isDigit(c) || (c === "." && isDigit(input[i + 1]))) {
      let start = i;
      while (i < input.length && (isDigit(input[i]) || input[i] === ".")) i++;
      const numStr = input.slice(start, i);
      if ((numStr.match(/\./g) || []).length > 1) throw new CalcError("Malformed number.");
      tokens.push({ type: "num", value: parseFloat(numStr) });
      continue;
    }
    if ("+-*/%^()".includes(c)) {
      tokens.push({ type: c });
      i++;
      continue;
    }
    throw new CalcError(`Unexpected character "${c}".`);
  }
  return tokens;
}

// Grammar (standard precedence, ^ right-associative, unary +/-):
//   expr   := term (('+' | '-') term)*
//   term   := power (('*' | '/' | '%') power)*
//   power  := unary ('^' power)?
//   unary  := ('+' | '-') unary | primary
//   primary:= number | '(' expr ')'
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function primary() {
    const t = peek();
    if (!t) throw new CalcError("Unexpected end of expression.");
    if (t.type === "num") { next(); return t.value; }
    if (t.type === "(") {
      next();
      const v = expr();
      if (!peek() || peek().type !== ")") throw new CalcError("Missing closing parenthesis.");
      next();
      return v;
    }
    throw new CalcError(`Unexpected token "${t.type}".`);
  }

  function unary() {
    const t = peek();
    if (t && (t.type === "+" || t.type === "-")) {
      next();
      const v = unary();
      return t.type === "-" ? -v : v;
    }
    return primary();
  }

  function power() {
    const base = unary();
    if (peek() && peek().type === "^") {
      next();
      const exp = power(); // right-associative
      return Math.pow(base, exp);
    }
    return base;
  }

  function term() {
    let v = power();
    while (peek() && (peek().type === "*" || peek().type === "/" || peek().type === "%")) {
      const op = next().type;
      const rhs = power();
      if (op === "*") v *= rhs;
      else if (op === "/") {
        if (rhs === 0) throw new CalcError("Division by zero.");
        v /= rhs;
      } else {
        if (rhs === 0) throw new CalcError("Division by zero.");
        v %= rhs;
      }
    }
    return v;
  }

  function expr() {
    let v = term();
    while (peek() && (peek().type === "+" || peek().type === "-")) {
      const op = next().type;
      const rhs = term();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  const result = expr();
  if (pos !== tokens.length) throw new CalcError("Unexpected trailing input.");
  return result;
}

// Returns a number, or throws CalcError with a user-safe message.
export function evaluateArithmetic(input) {
  if (typeof input !== "string" || input.length === 0) throw new CalcError("Empty expression.");
  if (input.length > 200) throw new CalcError("Expression too long.");
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new CalcError("Empty expression.");
  const result = parse(tokens);
  if (!Number.isFinite(result)) throw new CalcError("Result is not a finite number.");
  return result;
}

// Pulls a bare arithmetic expression out of a chat-style message, e.g.
// "what's 12 * (4+1)?" -> "12 * (4+1)". Returns null if nothing looks
// like a calculation worth routing to the calculator tool.
export function extractArithmeticExpression(text) {
  const match = text.match(/[-+]?[\d.\s]*[\d](?:\s*[-+*/%^()]\s*[-+]?[\d.\s()]+)+/);
  if (!match) return null;
  const candidate = match[0].trim();
  if (!/[-+*/%^]/.test(candidate)) return null;
  return candidate;
}

export { CalcError };
