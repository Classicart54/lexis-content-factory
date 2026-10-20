import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const soft = Easing.bezier(0.45, 0, 0.55, 1);

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const palette = {
  ink: '#101014',
  muted: '#62636b',
  line: 'rgba(16, 16, 20, 0.12)',
  glass: 'rgba(255, 255, 255, 0.74)',
  blue: '#2377ff',
  mint: '#25c28a',
  coral: '#ff6b57',
  amber: '#f6b545',
  violet: '#7a5cff',
};

const steps = [
  {label: 'Бриф', color: palette.blue},
  {label: 'Факты', color: palette.mint},
  {label: 'Структура', color: palette.amber},
  {label: 'Текст', color: palette.coral},
  {label: 'Проверка', color: palette.violet},
  {label: 'Публикация', color: palette.ink},
];

const agents = [
  {title: 'Поисковик', text: 'источники и даты'},
  {title: 'Структурщик', text: 'логика блоков'},
  {title: 'Писатель', text: 'текст по фактам'},
  {title: 'Ревьюер', text: 'смысл и честность'},
];

const seconds = (value: number, fps: number) => value * fps;

const progressBetween = (frame: number, from: number, to: number, easing = ease) =>
  interpolate(frame, [from, to], [0, 1], {...clamp, easing});

const fadeWindow = (frame: number, duration: number, fps: number) => {
  const enter = progressBetween(frame, 0, seconds(0.7, fps));
  const exit = progressBetween(frame, duration - seconds(0.7, fps), duration, Easing.in(Easing.cubic));
  return enter * (1 - exit);
};

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 600], [-24, 24], {...clamp, easing: soft});
  const glow = interpolate(frame, [0, 300, 600], [0.62, 0.9, 0.66], {...clamp, easing: soft});

  return (
    <AbsoluteFill style={{background: '#f7f8fb', overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 20% 18%, rgba(35,119,255,0.18), transparent 28%), radial-gradient(circle at 78% 22%, rgba(37,194,138,0.16), transparent 26%), radial-gradient(circle at 58% 78%, rgba(255,107,87,0.13), transparent 30%), linear-gradient(135deg, #ffffff 0%, #f5f6fa 46%, #edf1f8 100%)',
          opacity: glow,
          transform: `translate3d(${drift}px, ${drift * -0.35}px, 0) scale(1.04)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(16,16,20,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(16,16,20,0.04) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'linear-gradient(to bottom, transparent, black 16%, black 78%, transparent)',
        }}
      />
    </AbsoluteFill>
  );
};

const Shell: React.FC<{children: React.ReactNode; opacity?: number}> = ({children, opacity = 1}) => (
  <AbsoluteFill
    style={{
      opacity,
      fontFamily:
        'Inter, SF Pro Display, SF Pro Text, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      color: palette.ink,
    }}
  >
    {children}
  </AbsoluteFill>
);

const Eyebrow: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div
    style={{
      fontSize: 30,
      fontWeight: 650,
      color: palette.blue,
      letterSpacing: 0,
      marginBottom: 26,
    }}
  >
    {children}
  </div>
);

const SceneTitle: React.FC<{title: string; note: string}> = ({title, note}) => (
  <div style={{width: 820}}>
    <h1 style={{fontSize: 92, lineHeight: 0.96, letterSpacing: 0, margin: 0, fontWeight: 760}}>{title}</h1>
    <p style={{fontSize: 32, lineHeight: 1.25, color: palette.muted, margin: '30px 0 0', fontWeight: 520}}>{note}</p>
  </div>
);

const GlassPanel: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({children, style}) => (
  <div
    style={{
      background: palette.glass,
      border: `1px solid ${palette.line}`,
      borderRadius: 34,
      boxShadow: '0 32px 80px rgba(34, 39, 57, 0.13)',
      backdropFilter: 'blur(22px)',
      ...style,
    }}
  >
    {children}
  </div>
);

const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = fadeWindow(frame, seconds(5, fps), fps);
  const lift = interpolate(progressBetween(frame, 0, seconds(1.15, fps)), [0, 1], [44, 0]);
  const lineProgress = progressBetween(frame, seconds(1.1, fps), seconds(3.8, fps), soft);

  return (
    <Shell opacity={opacity}>
      <div style={{position: 'absolute', left: 148, top: 150, transform: `translateY(${lift}px)`}}>
        <Eyebrow>ИИ-конвейер Lexis Voice</Eyebrow>
        <SceneTitle title="Материал проходит путь сам" note="От заявки в Telegram до готового текста с проверками и артефактами." />
      </div>
      <GlassPanel style={{position: 'absolute', right: 148, top: 190, width: 690, height: 520, padding: 44}}>
        <div style={{fontSize: 24, color: palette.muted, fontWeight: 640}}>Заявка A-0001</div>
        <div style={{fontSize: 44, lineHeight: 1.1, fontWeight: 750, marginTop: 16}}>“Сравнить решения для речевой аналитики”</div>
        <div style={{position: 'absolute', left: 52, right: 52, bottom: 92, height: 6, background: 'rgba(16,16,20,0.08)', borderRadius: 8}}>
          <div style={{height: '100%', width: `${lineProgress * 100}%`, background: palette.blue, borderRadius: 8}} />
        </div>
        <div style={{position: 'absolute', left: 52, right: 52, bottom: 46, display: 'flex', justifyContent: 'space-between'}}>
          {steps.slice(0, 4).map((step, index) => (
            <div key={step.label} style={{display: 'flex', alignItems: 'center', gap: 10, opacity: lineProgress > index / 4 ? 1 : 0.34}}>
              <span style={{width: 14, height: 14, borderRadius: 14, background: step.color}} />
              <span style={{fontSize: 21, fontWeight: 650}}>{step.label}</span>
            </div>
          ))}
        </div>
      </GlassPanel>
    </Shell>
  );
};

const AgentsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = fadeWindow(frame, seconds(5, fps), fps);

  return (
    <Shell opacity={opacity}>
      <div style={{position: 'absolute', left: 148, top: 136}}>
        <Eyebrow>Агенты работают по контракту</Eyebrow>
        <SceneTitle title="Каждый шаг знает вход и выход" note="Никакого свободного хаоса: только структурированные данные и понятный следующий владелец." />
      </div>
      <div style={{position: 'absolute', left: 150, right: 150, bottom: 122, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24}}>
        {agents.map((agent, index) => {
          const appear = progressBetween(frame, seconds(0.4 + index * 0.22, fps), seconds(1.35 + index * 0.22, fps));
          const y = interpolate(appear, [0, 1], [46, 0]);
          return (
            <GlassPanel key={agent.title} style={{height: 248, padding: 32, transform: `translateY(${y}px)`, opacity: appear}}>
              <div style={{width: 54, height: 54, borderRadius: 18, background: steps[index + 1].color, marginBottom: 42}} />
              <div style={{fontSize: 36, fontWeight: 760}}>{agent.title}</div>
              <div style={{fontSize: 25, color: palette.muted, marginTop: 14, fontWeight: 560}}>{agent.text}</div>
            </GlassPanel>
          );
        })}
      </div>
    </Shell>
  );
};

const FlowScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = fadeWindow(frame, seconds(5, fps), fps);
  const rail = progressBetween(frame, seconds(0.5, fps), seconds(4.05, fps), soft);

  return (
    <Shell opacity={opacity}>
      <div style={{position: 'absolute', top: 126, left: 0, right: 0, textAlign: 'center'}}>
        <Eyebrow>Маршрутизация и проверки</Eyebrow>
        <h2 style={{fontSize: 78, margin: 0, fontWeight: 760, letterSpacing: 0}}>Ошибки возвращаются к нужному агенту</h2>
      </div>
      <div style={{position: 'absolute', left: 180, right: 180, top: 520, height: 8, borderRadius: 10, background: 'rgba(16,16,20,0.09)'}}>
        <div style={{height: '100%', width: `${rail * 100}%`, borderRadius: 10, background: `linear-gradient(90deg, ${palette.blue}, ${palette.mint}, ${palette.amber}, ${palette.coral}, ${palette.violet})`}} />
      </div>
      {steps.map((step, index) => {
        const x = 180 + index * ((1920 - 360) / (steps.length - 1));
        const appear = progressBetween(frame, seconds(0.45 + index * 0.25, fps), seconds(1.2 + index * 0.25, fps));
        const active = rail >= index / (steps.length - 1) ? 1 : 0.35;
        return (
          <div key={step.label} style={{position: 'absolute', left: x - 92, top: 455, width: 184, textAlign: 'center', opacity: appear * active}}>
            <div style={{width: 72, height: 72, borderRadius: 24, margin: '0 auto 22px', background: step.color, boxShadow: `0 18px 44px ${step.color}55`}} />
            <div style={{fontSize: 25, fontWeight: 700}}>{step.label}</div>
          </div>
        );
      })}
      <GlassPanel style={{position: 'absolute', left: 625, bottom: 96, width: 670, padding: 34, textAlign: 'center'}}>
        <div style={{fontSize: 34, fontWeight: 730}}>Машинная приемка → LLM-ревью → публикация</div>
        <div style={{fontSize: 24, color: palette.muted, marginTop: 12, fontWeight: 540}}>Факты, структура и текст проходят общий контроль качества.</div>
      </GlassPanel>
    </Shell>
  );
};

const ArtifactScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = fadeWindow(frame, seconds(5, fps), fps);
  const reveal = progressBetween(frame, seconds(0.45, fps), seconds(2.3, fps), soft);

  const artifacts = ['brief.json', 'facts.json', 'structure.json', 'draft.json', 'review.json'];

  return (
    <Shell opacity={opacity}>
      <div style={{position: 'absolute', left: 150, top: 132}}>
        <Eyebrow>Все прозрачно</Eyebrow>
        <SceneTitle title="Артефакты сохраняются" note="Заявка, решения агентов и отчеты проверок остаются в истории материала." />
      </div>
      <GlassPanel style={{position: 'absolute', right: 152, top: 132, width: 640, height: 700, padding: 38}}>
        <div style={{fontSize: 25, color: palette.muted, fontWeight: 650}}>data/requests/A-0001</div>
        <div style={{marginTop: 36, display: 'grid', gap: 16}}>
          {artifacts.map((artifact, index) => {
            const item = progressBetween(frame, seconds(0.55 + index * 0.22, fps), seconds(1.2 + index * 0.22, fps));
            return (
              <div key={artifact} style={{height: 78, borderRadius: 22, background: 'rgba(255,255,255,0.82)', border: `1px solid ${palette.line}`, display: 'flex', alignItems: 'center', padding: '0 24px', gap: 18, opacity: item, transform: `translateX(${interpolate(item, [0, 1], [34, 0])}px)`}}>
                <span style={{width: 18, height: 18, borderRadius: 18, background: steps[index].color}} />
                <span style={{fontSize: 28, fontWeight: 690}}>{artifact}</span>
              </div>
            );
          })}
        </div>
        <div style={{position: 'absolute', left: 38, right: 38, bottom: 38, height: 8, background: 'rgba(16,16,20,0.08)', borderRadius: 8}}>
          <div style={{height: '100%', width: `${reveal * 100}%`, background: palette.mint, borderRadius: 8}} />
        </div>
      </GlassPanel>
    </Shell>
  );
};

const FinaleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = fadeWindow(frame, seconds(4, fps), fps);
  const scale = interpolate(progressBetween(frame, 0, seconds(1.35, fps)), [0, 1], [0.96, 1]);
  const pulse = interpolate(frame, [0, seconds(2, fps), seconds(4, fps)], [0.92, 1, 0.96], {...clamp, easing: soft});

  return (
    <Shell opacity={opacity}>
      <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center'}}>
        <div style={{transform: `scale(${scale})`}}>
          <div style={{width: 150, height: 150, borderRadius: 46, margin: '0 auto 42px', background: `linear-gradient(135deg, ${palette.blue}, ${palette.mint})`, boxShadow: `0 30px 90px rgba(35,119,255,${0.22 * pulse})`}} />
          <h2 style={{fontSize: 96, lineHeight: 1, margin: 0, fontWeight: 780, letterSpacing: 0}}>От брифа до публикации</h2>
          <p style={{fontSize: 34, lineHeight: 1.25, color: palette.muted, margin: '28px auto 0', width: 900, fontWeight: 540}}>Конвейер ведет материал, проверяет факты и оставляет понятный след каждого решения.</p>
        </div>
      </div>
    </Shell>
  );
};

export const ArticlePipelinePromo: React.FC = () => {
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill>
      <Background />
      <Sequence from={0} durationInFrames={seconds(5, fps)} premountFor={seconds(1, fps)}>
        <IntroScene />
      </Sequence>
      <Sequence from={seconds(4.6, fps)} durationInFrames={seconds(5, fps)} premountFor={seconds(1, fps)}>
        <AgentsScene />
      </Sequence>
      <Sequence from={seconds(9.2, fps)} durationInFrames={seconds(5, fps)} premountFor={seconds(1, fps)}>
        <FlowScene />
      </Sequence>
      <Sequence from={seconds(13.8, fps)} durationInFrames={seconds(5, fps)} premountFor={seconds(1, fps)}>
        <ArtifactScene />
      </Sequence>
      <Sequence from={seconds(18, fps)} durationInFrames={seconds(2, fps)} premountFor={seconds(1, fps)}>
        <FinaleScene />
      </Sequence>
    </AbsoluteFill>
  );
};
