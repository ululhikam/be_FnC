import { Request, Response, NextFunction } from 'express';
import { TOPICS } from '../constants/topics.js';

export class TopicController {
  static async getTopics(req: Request, res: Response, next: NextFunction) {
    try {
      return res.status(200).json({
        data: TOPICS,
      });
    } catch (error) {
      next(error);
    }
  }
}
