import { Controller, Post, Body, Res, Req, UnauthorizedException, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { ApiTags } from '@nestjs/swagger';
import { zodToOpenAPI } from 'nestjs-zod';
import express from 'express'; // for esm
import { BaseController, getEnv, User, UserInfo, userSchemas } from '@packages/common';
import type { CreateUserDto } from '@packages/common';
import { API } from '@packages/common';

const userCreateSchema = zodToOpenAPI(userSchemas.Create);
const userResponseSchema = zodToOpenAPI(userSchemas.Response);
const authResponseSchema = {
  type: 'object',
  properties: {
    token: { type: 'string', example: 'access-token' },
    user: userResponseSchema,
  },
};
const loginRequestSchema = {
  type: 'object',
  properties: {
    email: { type: 'string', example: 'user@example.com' },
    password: { type: 'string', example: 'password123' },
  },
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController extends BaseController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService
  ) {
    super();
  }

  /** 📌 RefreshToken을 쿠키에 설정 */
  public setRefreshToken(res: express.Response, refreshToken: string) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: false, // 개발 환경에서는 false (운영에서는 true)
      sameSite: 'lax', // 크로스 사이트 요청 허용
    });
  }

  /** 📌 소셜 로그인 시 공통 응답 처리 */
  private async sendSocialAuthResponse(
    res: express.Response,
    tokens: { accessToken: string; refreshToken: string },
    user: User
  ) {
    this.setRefreshToken(res, tokens.refreshToken);
    const userString = encodeURIComponent(JSON.stringify(user));
    const redirectUrl = `${getEnv(this.configService, 'FRONTEND_URL')}/auth/callback?token=${tokens.accessToken}&user=${userString}`;
    return res.redirect(redirectUrl);
  }

  /** 📌 로그인, 회원가입, 토큰 갱신 시 공통 응답 처리 */
  private async sendAuthResponse(
    res: express.Response,
    tokens: { accessToken: string; refreshToken: string },
    user: User
  ) {
    this.setRefreshToken(res, tokens.refreshToken);
    return res.json({ token: tokens.accessToken, user });
  }

  /** 📌 유저가 없으면 예외 발생 */
  private validateUserExistence(user: Express.User | undefined) {
    if (!user) {
      throw new UnauthorizedException('사용자 정보를 찾을 수 없습니다.');
    }
  }

  /** 📌 Google / GitHub 로그인 페이지 이동 */
  @Get(['google'])
  @API({
    authRequired: ['google'],
    autoComplete: false,
  })
  async googleAuthLoginRoute() {
    return { message: 'Social Auth - google' };
  }

  @Get(['github'])
  @API({
    authRequired: ['github'],
    autoComplete: false,
  })
  async githubAuthLoginRoute() {
    return { message: 'Social Auth - github' };
  }

  /** 📌 Google / GitHub 로그인 콜백 */
  @Get(['google/callback'])
  @API({
    authRequired: ['google'],
    autoComplete: false,
  })
  async googleAuthLoginCallback(@Req() req: { user: Express.User }, @Res() res: express.Response) {
    const { tokens, user } = await this.authService.validateOAuthLogin(req.user);
    return this.sendSocialAuthResponse(res, await tokens, user);
  }

  @Get(['github/callback'])
  @API({
    authRequired: ['github'],
    autoComplete: false,
  })
  async githubAuthLoginCallback(@Req() req: { user: Express.User }, @Res() res: express.Response) {
    const { tokens, user } = await this.authService.validateOAuthLogin(req.user);
    return this.sendSocialAuthResponse(res, await tokens, user);
  }

  /** 📌 회원가입 */
  @Post('register')
  @API({
    authRequired: false,
    requestBody: userCreateSchema,
    responseSchema: authResponseSchema,
  })
  async register(@Body() createUserDto: CreateUserDto, @Res() res: express.Response) {
    const { tokens, user } = await this.authService.register(createUserDto);
    this.sendAuthResponse(res, await tokens, user);
  }

  /** 📌 로그인 */
  @Post('login')
  @API({
    authRequired: false,
    requestBody: loginRequestSchema,
    responseSchema: authResponseSchema,
  })
  async login(@Body() body: { email: string; password: string }, @Res() res: express.Response) {
    const { tokens, user } = await this.authService.login(body.email, body.password);
    this.sendAuthResponse(res, await tokens, user);
  }

  /** 📌 로그아웃 */
  @Post('logout')
  @API({ authRequired: ['jwt'] })
  async logout(@UserInfo() user: Express.User, @Res() res: express.Response) {
    await this.authService.logout(user?.id);
    res.setHeader('Set-Cookie', this.authService.getCookieForLogOut());
    return res.json({ message: 'Logged out successfully' });
  }

  /** 📌 토큰 갱신 */
  @Post('refresh')
  @API({
    authRequired: false,
    requestBody: null,
    responseSchema: authResponseSchema,
  })
  async refresh(@Req() req: express.Request, @Res() res: express.Response) {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }
    const { tokens, user } = await this.authService.refreshTokens(refreshToken);
    this.sendAuthResponse(res, await tokens, user);
  }

  /** 📌 현재 로그인한 사용자 프로필 조회 + 토큰 반환 */
  @Get('profile')
  @API({
    authRequired: ['jwt'],
    requestBody: null,
    responseSchema: authResponseSchema,
  })
  async getProfile(@UserInfo() user: Express.User, @Req() req: express.Request, @Res() res: express.Response) {
    this.validateUserExistence(user);
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    console.log('token', token);
    return res.json({ token, user });
  }
}
