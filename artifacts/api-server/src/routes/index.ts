import { Router, type IRouter } from "express";
import healthRouter from "./health";
import animeRouter from "./anime";
import commentsRouter from "./comments";
import communityRouter from "./community";
import discoveryRouter from "./discovery";
import proxyRouter from "./proxy";
import gogoRouter from "./gogo";
import kotoRouter from "./koto";
import mkissaRouter from "./mkissa";
import anizoneRouter from "./anizone";
import viewersRouter from "./viewers";
import votesRouter from "./votes";
import reviewsRouter from "./reviews";

const router: IRouter = Router();

router.use(healthRouter);
router.use(animeRouter);
router.use(commentsRouter);
router.use(communityRouter);
router.use(discoveryRouter);
router.use(proxyRouter);
router.use(gogoRouter);
router.use(kotoRouter);
router.use(mkissaRouter);
router.use(anizoneRouter);
router.use(viewersRouter);
router.use(votesRouter);
router.use(reviewsRouter);

export default router;
