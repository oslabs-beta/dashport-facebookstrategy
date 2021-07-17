import { OakContext, Options, AuthData, TokenData, KeyVal } from './types.ts';

/**
 * Guidance referrence
 * https://developers.facebook.com/docs/facebook-login/manually-build-a-login-flow/
 * 
 * Creates an instance of `FacebookStrategy`.
 * 
 *
 * * Options:
 *
 *   - client_id: string                  Required // pls don't change this variable name, it is facebook variable name
 *   - client_secret: string              Required // pls don't change this variable name, it is facebook variable name
 *   - redirect_uri: string               Required // pls don't change this variable name, it is facebook variable name
 *   - state: string                      Required 
 *   - scope: string
 *   - response_type: string                        // pls don't change this variable name, it is facebook variable name
 *
 * Examples:
 * 
 *     dashport.use(new FacebookStrategy({
 *         authorizationURL: 'https://www.example.com/oauth2/authorize',
 *         tokenURL: 'https://www.example.com/oauth2/token',
 *         client_id: '123-456-789',
 *         client_secret: 'shhh-its-a-secret'
 *         callbackURL: 'https://www.example.net/auth/example/callback'
 *       },
 *       function(access_token, refreshToken, profile, done) {
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
    if (!options.client_id || !options.redirect_uri || !options.state || !options.client_secret) {
      throw new Error('ERROR in FacebookStrategy constructor: Missing required arguments');
    }

    this.options = options;
    this.authURL = 'https://www.facebook.com/v11.0/dialog/oauth?' //  using v.10, version may change overtime
    this.tokenURL = 'https://graph.facebook.com/v11.0/oauth/access_token?' //  using v.10, version may change overtime
    this.authDataURL = 'https://graph.facebook.com/debug_token?'

    // preStep1 request permission 
    // CONSTRUCTS THE REDIRECT URI FROM THE PARAMETERS PROVIDED
    this.uriFromParams = this.constructURI(this.options, 'client_secret');    
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
    //debugger;
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
    // splits the string at the ampersand(&), storing the string with the access_token in URI2[0] 
    // and the other parameters at URI2[n]
    const URI2: string[] = URI1[1].split('&');
    // PARSE THE URI
    const code: string = this.parseCode(URI2[0]);debugger;

    const tokenOptions: Options = {
      client_id: this.options.client_id,
      redirect_uri: this.options.redirect_uri,
      client_secret: this.options.client_secret,
      code: code,
    }

    // SEND A FETCH REQ FOR TOKEN
    try {
      const ResponeData = await fetch(this.tokenURL+this.constructURI(tokenOptions));
      const data : TokenData = await ResponeData.json();debugger;

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
        access_token: parsed.access_token,
        token_type: parsed.token_type,
        expires_in: parsed.expires_in,
      },
      userInfo: {
        provider: '',
        providerUserId: ''
      }
    }
    debugger;
    // STEP 5.5: request user info
    const authOptions = {
      input_token: authData.tokenData.access_token,
      access_token: this.options.client_id + '|' + this.options.client_secret
    };

    try {
      const ResponseData = await fetch(this.authDataURL + this.constructURI(authOptions));
      const data = await ResponseData.json();debugger;
      // once get user_id the we can fetch name and emails using graph-api
      //https://developers.facebook.com/docs/graph-api/using-graph-api/#fields
      const ResponseUserData = await fetch(`https://graph.facebook.com/${data.data.user_id}?
      fields=name,email&access_token=${authOptions.input_token}`)
      const userdata = await ResponseUserData.json()

      authData.userInfo = {
        provider: this.name,
        providerUserId: userdata.id,// or --> data.data.user_id,
        displayName:userdata.name,
        emails:[userdata.email]
      };

      return authData;
    } catch(err) {
      return new Error(`ERROR in getAuthData: Unable to obtain auth data - ${err}`);
    }
  }
}
