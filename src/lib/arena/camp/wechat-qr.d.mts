export class WechatQrLogin {
 constructor(options:{proxy?:string;onAuthorization:(value:unknown)=>Promise<void>;executablePath?:string;network?:unknown;ttlMs?:number;pollDelayMs?:number});
 start():Promise<{id:string;qrImage:string;expiresAt:number;message:string}>;
 poll():{status:string;message:string};stop():Promise<void>;
}
