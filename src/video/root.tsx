import React from 'react';
import {Composition} from 'remotion';
import {ArticlePipelinePromo} from './ArticlePipelinePromo';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ArticlePipelinePromo"
      component={ArticlePipelinePromo}
      durationInFrames={600}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
