import { Request, Response, NextFunction } from 'express';
import { CommentService } from '../services/comment.service.js';
import { successResponse } from '../utils/response.util.js';

export class CommentController {
  static async getComments(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await CommentService.getComments(id, page, limit, req.user);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async addComment(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { text, parent_id } = req.body;

      const comment = await CommentService.addComment(id, text, req.user, parent_id);
      return successResponse(res, comment, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateComment(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const commentId = String(req.params.commentId);
      const { text } = req.body;

      const comment = await CommentService.updateComment(id, commentId, text, req.user!);
      return successResponse(res, comment, 200);
    } catch (error) {
      next(error);
    }
  }

  static async deleteComment(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const commentId = String(req.params.commentId);

      const result = await CommentService.deleteComment(id, commentId, req.user!);
      return successResponse(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
