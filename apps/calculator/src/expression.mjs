const MAX_EXPRESSION_LENGTH = 512;
const MAX_ABS_RESULT = 1e308;

const FUNCTIONS = Object.freeze({
  sqrt: (value) => {
    if (value < 0) throw new RangeError("sqrt domain error");
    return Math.sqrt(value);
  },
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: (value) => {
    if (value <= 0) throw new RangeError("ln domain error");
    return Math.log(value);
  },
  log: (value) => {
    if (value <= 0) throw new RangeError("log domain error");
    return Math.log10(value);
  },
});

const CONSTANTS = Object.freeze({ pi: Math.PI, e: Math.E });

function assertFinite(value) {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS_RESULT) {
    throw new RangeError("result is outside supported numeric range");
  }
  return value;
}

function tokenize(source) {
  const normalized = source.trim().toLowerCase().replaceAll(",", ".");
  if (!normalized || normalized.length > MAX_EXPRESSION_LENGTH) {
    throw new TypeError("expression must contain between 1 and 512 characters");
  }

  const tokens = [];
  let index = 0;
  while (index < normalized.length) {
    const char = normalized[index];
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/u.test(char)) {
      const start = index;
      let dots = 0;
      while (index < normalized.length && /[0-9.]/u.test(normalized[index])) {
        if (normalized[index] === ".") dots += 1;
        index += 1;
      }
      const raw = normalized.slice(start, index);
      if (dots > 1 || raw === ".") throw new SyntaxError("invalid number");
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new RangeError("number is outside supported range");
      tokens.push({ type: "number", value });
      continue;
    }

    if (/[a-z]/u.test(char)) {
      const start = index;
      while (index < normalized.length && /[a-z]/u.test(normalized[index])) index += 1;
      tokens.push({ type: "identifier", value: normalized.slice(start, index) });
      continue;
    }

    if ("+-*/%^()".includes(char)) {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }

    throw new SyntaxError(`unsupported character: ${char}`);
  }

  tokens.push({ type: "eof", value: null });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
  }

  peek(type) {
    return this.tokens[this.position]?.type === type;
  }

  consume(type) {
    const token = this.tokens[this.position];
    if (!token || token.type !== type) throw new SyntaxError(`expected ${type}`);
    this.position += 1;
    return token;
  }

  parse() {
    const value = this.parseAdditive();
    this.consume("eof");
    return assertFinite(value);
  }

  parseAdditive() {
    let value = this.parseMultiplicative();
    while (this.peek("+") || this.peek("-")) {
      const operator = this.tokens[this.position++].type;
      const right = this.parseMultiplicative();
      value = assertFinite(operator === "+" ? value + right : value - right);
    }
    return value;
  }

  parseMultiplicative() {
    let value = this.parsePower();
    while (this.peek("*") || this.peek("/") || this.peek("%")) {
      const operator = this.tokens[this.position++].type;
      const right = this.parsePower();
      if ((operator === "/" || operator === "%") && right === 0) {
        throw new RangeError("division by zero");
      }
      if (operator === "*") value *= right;
      else if (operator === "/") value /= right;
      else value %= right;
      value = assertFinite(value);
    }
    return value;
  }

  parsePower() {
    const left = this.parseUnary();
    if (!this.peek("^")) return left;
    this.consume("^");
    return assertFinite(left ** this.parsePower());
  }

  parseUnary() {
    if (this.peek("+")) {
      this.consume("+");
      return this.parseUnary();
    }
    if (this.peek("-")) {
      this.consume("-");
      return assertFinite(-this.parseUnary());
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    if (this.peek("number")) return this.consume("number").value;

    if (this.peek("identifier")) {
      const identifier = this.consume("identifier").value;
      if (Object.hasOwn(CONSTANTS, identifier)) return CONSTANTS[identifier];
      if (!Object.hasOwn(FUNCTIONS, identifier)) throw new SyntaxError(`unknown identifier: ${identifier}`);
      this.consume("(");
      const argument = this.parseAdditive();
      this.consume(")");
      return assertFinite(FUNCTIONS[identifier](argument));
    }

    if (this.peek("(")) {
      this.consume("(");
      const value = this.parseAdditive();
      this.consume(")");
      return value;
    }

    throw new SyntaxError("expected a number, function, constant, or parenthesis");
  }
}

export function calculateExpression(source) {
  if (typeof source !== "string") throw new TypeError("expression must be a string");
  return new Parser(tokenize(source)).parse();
}

export function formatResult(value) {
  assertFinite(value);
  if (Object.is(value, -0)) return "0";
  return Number.parseFloat(value.toPrecision(12)).toString();
}
