'use client';

import type { RefObject } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic,
  MicOff,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProactiveCard } from '@/components/chat/proactive-card';
import { AvatarDisplay } from '@/components/ui/avatar-display';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import type { DiscussionAction } from '@/lib/types/action';
import type { EngineMode } from '@/lib/playback';
import type { Participant } from '@/lib/types/roundtable';
import type { AgentConfig } from '@/lib/orchestration/registry/types';

export interface ParticipantsRailPanelProps {
  agentScrollRef: RefObject<HTMLDivElement | null>;
  studentParticipants: Participant[];
  teacherParticipant: Participant | undefined;
  discussionRequest: DiscussionAction | null;
  discussionAnchorRef: RefObject<HTMLDivElement | null>;
  speakingAgentId?: string | null;
  thinkingState?: { stage: string; agentId?: string } | null;
  getAgentConfig: (id: string) => AgentConfig | undefined;
  t: (key: string) => string;
  engineMode: EngineMode;
  onDiscussionSkip?: () => void;
  onDiscussionStart?: (action: DiscussionAction) => void;
  onPlayPause?: () => void;
  isSendCooldown: boolean;
  asrEnabled: boolean;
  isVoiceOpen: boolean;
  isInputOpen: boolean;
  activeRole: 'teacher' | 'user' | 'agent' | null;
  isCueUser?: boolean;
  userAvatar: string;
  handleToggleVoice: () => void;
  handleToggleInput: () => void;
  onStudentAvatarRef: (studentId: string, element: HTMLDivElement | null) => void;
}

export function ParticipantsRailPanel({
  agentScrollRef,
  studentParticipants,
  teacherParticipant,
  discussionRequest,
  discussionAnchorRef,
  speakingAgentId,
  thinkingState,
  getAgentConfig,
  t,
  engineMode,
  onDiscussionSkip,
  onDiscussionStart,
  onPlayPause,
  isSendCooldown,
  asrEnabled,
  isVoiceOpen,
  isInputOpen,
  activeRole,
  isCueUser,
  userAvatar,
  handleToggleVoice,
  handleToggleInput,
  onStudentAvatarRef,
}: ParticipantsRailPanelProps) {
  return (
    <>
      <div className="flex-none relative group/scroll">
        <button
          type="button"
          onClick={() => {
            agentScrollRef.current?.scrollBy({
              left: -80,
              behavior: 'smooth',
            });
          }}
          className="absolute left-0 top-0 bottom-0 w-5 z-10 flex items-center justify-center bg-gradient-to-r from-gray-50/90 dark:from-gray-900/90 to-transparent opacity-0 group-hover/scroll:opacity-100 transition-opacity cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-gray-400" />
        </button>

        <div
          ref={agentScrollRef}
          className="overflow-x-auto overflow-y-hidden px-2 scrollbar-hide"
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
              e.currentTarget.scrollLeft += e.deltaY;
              e.preventDefault();
            }
          }}
        >
          <div className="flex gap-1 w-max py-1">
            {studentParticipants.map((student) => {
              const isSpeaking = speakingAgentId === student.id;
              const isThinkingAgent =
                thinkingState?.stage === 'agent_loading' && thinkingState.agentId === student.id;
              const agentConfig = getAgentConfig(student.id);
              const roleLabelKey = agentConfig?.role as
                | 'teacher'
                | 'assistant'
                | 'student'
                | undefined;
              const roleLabel = roleLabelKey ? t(`settings.agentRoles.${roleLabelKey}`) : '';
              const i18nDescription = t(`settings.agentDescriptions.${student.id}`);
              const description =
                i18nDescription !== `settings.agentDescriptions.${student.id}`
                  ? i18nDescription
                  : agentConfig?.persona || '';
              const hasDescription = !!description;
              const isDiscussionAgent =
                !!discussionRequest && discussionRequest.agentId === student.id;
              return (
                <div
                  key={student.id}
                  data-agent-id={student.id}
                  ref={(el) => onStudentAvatarRef(student.id, el)}
                  className="relative group/student shrink-0"
                >
                  {isDiscussionAgent && (
                    <motion.div
                      animate={{
                        scale: [1, 1.2, 1],
                        opacity: [0.7, 0, 0.7],
                      }}
                      transition={{
                        repeat: Infinity,
                        duration: 2,
                        ease: 'easeInOut',
                      }}
                      className="absolute inset-0 rounded-full pointer-events-none"
                      style={{
                        border: `2px solid ${agentConfig?.color || '#d97706'}`,
                      }}
                    />
                  )}
                  <HoverCard openDelay={300} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <div
                        className={cn(
                          'relative w-9 h-9 rounded-full transition-all duration-300 cursor-pointer',
                          isSpeaking
                            ? 'opacity-100 grayscale-0 scale-110'
                            : 'opacity-50 grayscale-[0.2] scale-95 hover:opacity-100 hover:grayscale-0 hover:scale-100',
                        )}
                      >
                        <div
                          className={cn(
                            'absolute inset-0 rounded-full border-2 transition-all duration-300',
                            isSpeaking
                              ? 'border-purple-500 dark:border-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.4)]'
                              : 'border-white dark:border-gray-700',
                          )}
                        />
                        <div className="absolute inset-0.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                          <img src={student.avatar} alt={student.name} className="w-full h-full" />
                        </div>
                        {isSpeaking && (
                          <div className="absolute -right-0.5 -top-0.5 w-3 h-3 bg-green-500 rounded-full border border-white dark:border-gray-800 z-20 flex items-center justify-center">
                            <div className="w-1 h-1 bg-white rounded-full animate-pulse" />
                          </div>
                        )}
                        {isThinkingAgent && (
                          <div className="absolute inset-0 rounded-full border-2 border-purple-400 border-t-transparent animate-spin z-20" />
                        )}
                      </div>
                    </HoverCardTrigger>
                    <HoverCardContent
                      side="bottom"
                      align="center"
                      className="w-64 p-3 max-h-[300px] overflow-y-auto"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-gray-100 dark:bg-gray-800">
                          <img
                            src={student.avatar}
                            alt={student.name}
                            className="w-full h-full"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{student.name}</p>
                          {roleLabel && roleLabel !== `settings.agentRoles.${roleLabelKey}` && (
                            <span
                              className="inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded-full text-white mt-0.5"
                              style={{
                                backgroundColor: agentConfig?.color || '#6b7280',
                              }}
                            >
                              {roleLabel}
                            </span>
                          )}
                        </div>
                      </div>
                      {hasDescription && (
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed whitespace-pre-line">
                          {description}
                        </p>
                      )}
                    </HoverCardContent>
                  </HoverCard>
                </div>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            agentScrollRef.current?.scrollBy({
              left: 80,
              behavior: 'smooth',
            });
          }}
          className="absolute right-0 top-0 bottom-0 w-5 z-10 flex items-center justify-center bg-gradient-to-l from-gray-50/90 dark:from-gray-900/90 to-transparent opacity-0 group-hover/scroll:opacity-100 transition-opacity cursor-pointer"
        >
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
        </button>

        <AnimatePresence>
          {discussionRequest &&
            discussionRequest.agentId !== teacherParticipant?.id &&
            (() => {
              const matchedStudent = studentParticipants.find(
                (s) => s.id === discussionRequest.agentId,
              );
              const agentConfig = getAgentConfig(discussionRequest.agentId || '');
              return (
                <ProactiveCard
                  action={discussionRequest}
                  mode={engineMode === 'paused' ? 'paused' : 'playback'}
                  anchorRef={discussionAnchorRef}
                  align="left"
                  agentName={matchedStudent?.name || agentConfig?.name}
                  agentAvatar={matchedStudent?.avatar || agentConfig?.avatar}
                  agentColor={agentConfig?.color}
                  onSkip={() => onDiscussionSkip?.()}
                  onListen={() => onDiscussionStart?.(discussionRequest)}
                  onTogglePause={() => onPlayPause?.()}
                />
              );
            })()}
        </AnimatePresence>
      </div>

      <div className="mx-auto my-1.5 w-8 h-px bg-gray-200 dark:bg-gray-700 opacity-50 shrink-0" />

      <div className="flex-1 flex items-center justify-center gap-3 px-2 min-h-0">
        <div className="flex flex-col gap-1.5 shrink-0">
          {isSendCooldown ? (
            <div className="flex items-center justify-center w-8 h-8">
              <div className="flex items-center gap-[3px]">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{
                      y: [0, -3, 0],
                      opacity: [0.35, 0.9, 0.35],
                    }}
                    transition={{
                      repeat: Infinity,
                      duration: 0.9,
                      delay: i * 0.12,
                      ease: 'easeInOut',
                    }}
                    className="w-[4px] h-[4px] rounded-full bg-purple-400 dark:bg-purple-400"
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (asrEnabled) handleToggleVoice();
                }}
                disabled={!asrEnabled}
                className={cn(
                  'w-8 h-8 rounded-full border flex items-center justify-center transition-all active:scale-95 shadow-sm',
                  !asrEnabled
                    ? 'bg-gray-100 dark:bg-gray-800/50 text-gray-300 dark:text-gray-600 border-gray-200 dark:border-gray-700 cursor-not-allowed'
                    : isVoiceOpen
                      ? 'bg-purple-600 dark:bg-purple-500 border-purple-600 dark:border-purple-500 text-white shadow-purple-200 dark:shadow-purple-800'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-200 dark:hover:border-purple-700',
                )}
              >
                {asrEnabled ? (
                  <Mic className="w-3.5 h-3.5" />
                ) : (
                  <MicOff className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleInput();
                }}
                className={cn(
                  'w-8 h-8 rounded-full border flex items-center justify-center transition-all active:scale-95 shadow-sm',
                  isInputOpen
                    ? 'bg-purple-600 dark:bg-purple-500 border-purple-600 dark:border-purple-500 text-white shadow-purple-200 dark:shadow-purple-800'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-200 dark:hover:border-purple-700',
                )}
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        <div
          className="relative group cursor-pointer shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleInput();
          }}
        >
          <div
            className={cn(
              'relative w-16 h-16 rounded-full transition-all duration-300 flex items-center justify-center',
              activeRole === 'user' || isInputOpen || isCueUser
                ? 'scale-105'
                : 'opacity-50 grayscale-[0.2] scale-95 group-hover:opacity-100 group-hover:grayscale-0 group-hover:scale-100',
            )}
          >
            <div
              className={cn(
                'absolute inset-0 rounded-full border-2 transition-all duration-300',
                isCueUser
                  ? 'border-amber-500 dark:border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.4)] animate-pulse'
                  : activeRole === 'user' || isInputOpen
                    ? 'border-purple-600 dark:border-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.3)]'
                    : 'border-white dark:border-gray-700 group-hover:border-purple-200 dark:group-hover:border-purple-600',
              )}
            />
            <div className="w-14 h-14 rounded-full bg-gray-50 dark:bg-gray-800 overflow-hidden relative z-10 shadow-sm border border-gray-50 dark:border-gray-700 text-2xl">
              <AvatarDisplay src={userAvatar} alt={t('roundtable.you')} />
            </div>
            <div className="absolute top-0 right-0 w-5 h-5 bg-white dark:bg-gray-800 rounded-full flex items-center justify-center shadow-md border border-gray-100 dark:border-gray-700 z-20">
              <div
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  isInputOpen || isCueUser
                    ? 'bg-purple-500 animate-pulse'
                    : 'bg-gray-300 dark:bg-gray-600',
                )}
              />
            </div>
          </div>
          <AnimatePresence>
            {isCueUser && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.9 }}
                className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 bg-amber-500 text-white text-[9px] font-bold rounded-full shadow-sm z-30"
              >
                {t('roundtable.yourTurn')}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
