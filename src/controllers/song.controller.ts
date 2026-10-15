import { Request, Response, NextFunction } from 'express';
import { SONGS } from '../constants/songs.js';
import { prisma } from '../config/prisma.js';

export class SongController {
  static async getSongs(req: Request, res: Response, next: NextFunction) {
    try {
      const query = (req.query.query as string)?.toLowerCase();
      const genre = req.query.genre as string;
      const sort = req.query.sort as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      // Filter in-memory SONGS array (or sync with DB if needed)
      let songs = [...SONGS];

      if (query) {
        songs = songs.filter(
          (s) =>
            s.title.toLowerCase().includes(query) ||
            s.artist.toLowerCase().includes(query) ||
            s.genre.toLowerCase().includes(query)
        );
      }

      if (genre) {
        songs = songs.filter((s) => s.genre.toLowerCase() === genre.toLowerCase());
      }

      if (sort === 'newest') {
        songs.reverse();
      } else {
        songs.sort((a, b) => b.popularity - a.popularity);
      }

      const data = songs.slice(0, limit);

      return res.status(200).json({
        data,
        total: songs.length,
      });
    } catch (error) {
      next(error);
    }
  }
}
