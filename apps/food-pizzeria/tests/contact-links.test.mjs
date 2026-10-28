import assert from "node:assert/strict";
import test from "node:test";
import { telephoneHref, whatsappHref } from "../src/ui/contact-links.mjs";

test("telephoneHref removes formatting and preserves an international prefix", () => {
  assert.equal(telephoneHref(" +55 (11) 99999-0000 "), "+5511999990000");
});

test("telephoneHref supports local numbers without inventing a country code", () => {
  assert.equal(telephoneHref("(11) 3333-2222"), "1133332222");
});

test("telephoneHref rejects empty values and strings without digits", () => {
  for (const value of ["", "  ", "+", "sem telefone", null, undefined, 11999990000]) {
    assert.equal(telephoneHref(value), null);
  }
});

test("whatsappHref normaliza telefones brasileiros e prepara o texto do pedido", () => {
  assert.equal(
    whatsappHref("(11) 99999-0000", "Seu pedido #1052 está pronto para retirada."),
    "https://wa.me/5511999990000?text=Seu%20pedido%20%231052%20est%C3%A1%20pronto%20para%20retirada.",
  );
  assert.equal(
    whatsappHref("+55 (11) 99999-0000", "Saiu para entrega & boa noite"),
    "https://wa.me/5511999990000?text=Saiu%20para%20entrega%20%26%20boa%20noite",
  );
  assert.equal(whatsappHref("+1 (212) 555-0100", "Order ready"), "https://wa.me/12125550100?text=Order%20ready");
});

test("whatsappHref não cria um link para telefone ou mensagem inválidos", () => {
  for (const [phone, message] of [["", "Pronto"], ["12345", "Pronto"], ["11 99999 0000", "  "], [null, "Pronto"], ["11 99999 0000", null]]) {
    assert.equal(whatsappHref(phone, message), null);
  }
});
