import { OakContext, Options, AuthData, TokenData, KeyVal } from './types.ts';

/**
 * Creates an instance of `FacebookStrategy`.
 * 
 *
 * * Options:
 *
 *   - clientId: string                  Required
 *   - clientSecret: string              Required
 *   - redirectUri: string               Required
 *   - state: string                      Required
 *   - scope: string
 *   - response_type: string
 *
 * Examples:
 * 
 *     dashport.use(new FacebookStrategy({
 *         authorizationURL: 'https://www.example.com/oauth2/authorize',
 *         tokenURL: 'https://www.example.com/oauth2/token',
 *         clientID: '123-456-789',
 *         clientSecret: 'shhh-its-a-secret'
 *         callbackURL: 'https://www.example.net/auth/example/callback'
 *       },
 *       function(accessToken, refreshToken, profile, done) {
 *         User.findOrCreate(..., function (err, user) {
 *           done(err, user);
 *         });
 *       }
 *     ));
 *
 */
export default class FacebookStrategy {
  name = 'facebook' // remove inferrable type string
  options: Options;
  uriFromParams: string;
  authURL: string;
  tokenURL: string;
  authDataURL: string;
  /**
   * @constructor
   * @param {Object} options
   * @api public
   */
  constructor (options: Options) {
    if (!options.clientId || !options.redirectUri || !options.state || !options.clientSecret) {
      throw new Error('ERROR in FacebookStrategy constructor: Missing required arguments');
    }

    this.options = options;
    this.authURL = 'https://www.facebook.com/v10.0/dialog/oauth?' //  using v.10, version may change overtime
    this.tokenURL = 'https://graph.facebook.com/v10.0/oauth/accessToken?' //  using v.10, version may change overtime
    this.authDataURL = 'https://graph.facebook.com/debug_token?'

    // preStep1 request permission 
    // CONSTRUCTS THE REDIRECT URI FROM THE PARAMETERS PROVIDED
    this.uriFromParams = this.constructURI(this.options, 'clientSecret');    
  }

  constructURI(options: KeyVal, skip?: string): string { // change type from any to string
    const paramArray: string[][] = Object.entries(options);
    let paramString = ''; // remove inferrable type string

    for (let i = 0; i < paramArray.length; i++) {
      const [key, value] = paramArray[i];

      // adds the key and '=' for every member of options needed for this request 
      if (key === skip) continue;

      paramString += (key + '=');
      paramString += (value + '&');
    }

    if (paramString[paramString.length - 1] === '&') {
      paramString = paramString.slice(0, -1);
    }

    return paramString;
  }

  parseCode(encodedCode: string): string {
    const replacements: { [name: string] : string } = {
      "%24": "$",
      "%26": "&",
      "%2B": "+",
      "%2C": ",",
      "%2F": "/",
      "%3A": ":",
      "%3B": ";",
      "%3D": "=",
      "%3F": "?",
      "%40": "@"
    }

    const toReplaceArray: string[] = Object.keys(replacements);

    for (let i = 0; i < toReplaceArray.length; i++) {
      while (encodedCode.includes(toReplaceArray[i])) {
        encodedCode = encodedCode.replace(toReplaceArray[i], replacements[toReplaceArray[i]]);
      }
    }

    return encodedCode; 
  }

  // ENTRY POINT
  async router(ctx: OakContext, next?: () => Promise<unknown>) {
    // GO_Step 2 Request Permission
    if (!ctx.request.url.search) return await this.authorize(ctx, next);
    // GO_Step 4 Exchange code for Token
    if (ctx.request.url.search.slice(1, 5) === 'code') return this.getAuthToken(ctx, next);
  }
  
  // STEP 2: sends the programatically constructed uri to fb's oauth 2.0 server
  async authorize(ctx: OakContext, _next?: () => Promise<unknown>) {
    return await ctx.response.redirect(this.authURL + this.uriFromParams);                   
  }

  // STEP 3: client says yes or no

  // STEP 4: handle oauth 2.0 server response containing auth code
  // STEP 4.5: request access token in exchange for auth code
  async getAuthToken(ctx: OakContext, _next?: () => Promise<unknown>) {
    const OGURI: string = ctx.request.url.search;

    if (OGURI.includes('error')) {
      return new Error('ERROR in getAuthToken: Received an error from auth token code request.');
    }

    // GET THE AUTH CODE
    // splits the string at the =, storing the first part in URI1[0] and the part wanted in URI1[1]
    const URI1: string[] = OGURI.split('=');
    // splits the string at the ampersand(&), storing the string with the accessToken in URI2[0] 
    // and the other parameters at URI2[n]
    const URI2: string[] = URI1[1].split('&');
    // PARSE THE URI
    const code: string = this.parseCode(URI2[0]);

    const tokenOptions: Options = {
      clientId: this.options.clientId,
      redirectUri: this.options.redirectUri,
      clientSecret: this.options.clientSecret,
      code: code,
    }

    // SEND A FETCH REQ FOR TOKEN
    try {
      const ResponeData = await fetch(this.tokenURL+this.constructURI(tokenOptions));
      const data : TokenData = await ResponeData.json();

      if (data.type === 'oAuthException') {
        return new Error('ERROR in getAuthToken: Token request threw OAuth exception.');
      }

      return this.getAuthData(data);
    } catch(err) {
      return new Error(`ERROR in getAuthToken: Unable to obtain token - ${err}`);
    }
  }

  // STEP 5 get the access token from the returned data
  // STEP 5.5 exchange access token for user info
  async getAuthData(parsed: TokenData){ 
    const authData: AuthData = {
      tokenData: {
        accessToken: parsed.accessToken,
        tokenType: parsed.tokenType,
        expiresIn: parsed.expiresIn,
      },
      userInfo: {
        provider: '',
        providerUserId: ''
      }
    }

    // STEP 5.5: request user info
    const authOptions = {
      inputToken: authData.tokenData.accessToken,
      accessToken: this.options.clientId + '|' + this.options.clientSecret
    };

    try {
      const ResponseData = await fetch(this.authDataURL + this.constructURI(authOptions));
      const data = await ResponseData.json();
      // once get user_id the we can fetch name and emails using graph-api
      //https://developers.facebook.com/docs/graph-api/using-graph-api/#fields
      const ResponseUserData = await fetch(`https://graph.facebook.com/${data.data.user_id}?
      fields=name,email&accessToken=${authOptions.inputToken}`)
      const userdata = await ResponseUserData.json()

      authData.userInfo = {
        provider: this.name,
        providerUserId: data.data.user_id,
        displayName:userdata.name,
        emails:[userdata.email]
      };

      return authData;
    } catch(err) {
      return new Error(`ERROR in getAuthData: Unable to obtain auth data - ${err}`);
    }
  }
}
