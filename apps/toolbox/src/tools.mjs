const PASSWORD_ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_=+";

function secureBytes(length){
  if(!Number.isInteger(length)||length<1||length>4096)throw new RangeError("secure byte request is outside bounds");
  const bytes=new Uint8Array(length);
  const cryptoObject=globalThis.crypto;
  if(!cryptoObject||typeof cryptoObject.getRandomValues!=="function")throw new TypeError("secure random source is unavailable");
  cryptoObject.getRandomValues(bytes);
  return bytes;
}

export function createUuid(){
  const cryptoObject=globalThis.crypto;
  if(typeof cryptoObject?.randomUUID==="function")return cryptoObject.randomUUID();
  const bytes=secureBytes(16);
  bytes[6]=(bytes[6]&0x0f)|0x40;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=[...bytes].map(value=>value.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function generatePassword(length=24){
  const size=Math.max(12,Math.min(128,Number.isFinite(length)?Math.trunc(length):24));
  const limit=256-(256%PASSWORD_ALPHABET.length);
  let value="";
  while(value.length<size){
    for(const byte of secureBytes(Math.min(256,(size-value.length)*3))){
      if(byte>=limit)continue;
      value+=PASSWORD_ALPHABET[byte%PASSWORD_ALPHABET.length];
      if(value.length===size)break;
    }
  }
  return value;
}

export async function sha256Text(text){
  if(typeof text!=="string")throw new TypeError("text must be a string");
  if(text.length>1_000_000)throw new RangeError("text is outside hash bounds");
  const subtle=globalThis.crypto?.subtle;
  if(!subtle?.digest)throw new TypeError("SHA-256 is unavailable");
  const digest=await subtle.digest("SHA-256",new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
}

export function encodeBase64(text){
  if(typeof text!=="string"||text.length>1_000_000)throw new TypeError("text is outside Base64 bounds");
  const bytes=new TextEncoder().encode(text);
  let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary);
}
export function decodeBase64(value){
  if(typeof value!=="string"||value.length>1_500_000)throw new TypeError("Base64 input is outside bounds");
  const binary=atob(value.trim());
  const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
  return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
export function encodeUrlComponent(text){if(typeof text!=="string")throw new TypeError("text must be a string");return encodeURIComponent(text);}
export function decodeUrlComponent(text){if(typeof text!=="string")throw new TypeError("text must be a string");return decodeURIComponent(text);}
