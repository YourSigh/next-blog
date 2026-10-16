export function authorizationUrl(state:string):string;
export function parseCallback(value:string,state:string):Record<string,string>|null;
export function qrToken(value:string):number;
export function parseQQCallback(value:string):string[]|null;
export class QQQrLogin {
 constructor(options:{proxy?:string;onAuthorization:(value:unknown)=>Promise<void>;executablePath?:string;network?:unknown;ttlMs?:number;pollDelayMs?:number});
 start():Promise<{id:string;qrImage:string;expiresAt:number;message:string}>;
 poll():{status:string;message:string};stop():Promise<void>;
}
