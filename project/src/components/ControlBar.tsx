import { Button, Flex, HStack, Icon, Text } from '@chakra-ui/react';
import { Mic, MicOff, Monitor, MonitorOff } from 'lucide-react';

interface ControlBarProps {
  disabled: boolean;
  isSharing: boolean;
  micOn: boolean;
  onToggleShare: () => void;
  onToggleMic: () => void;
}

export default function ControlBar({ disabled, isSharing, micOn, onToggleShare, onToggleMic }: ControlBarProps) {
  return (
    <Flex
      direction={{ base: 'column', sm: 'row' }}
      align={{ base: 'stretch', sm: 'center' }}
      justify={{ sm: 'space-between' }}
      gap={3}
      borderRadius="2xl"
      border="1px solid"
      borderColor="whiteAlpha.200"
      bg="blackAlpha.600"
      p={3}
      px={{ sm: 4 }}
      backdropFilter="blur(12px)"
    >
      <Text px={2} fontSize="sm" color="whiteAlpha.600">
        {isSharing ? 'Viewers are watching your screen live.' : 'Use headphones to keep your voice from echoing.'}
      </Text>
      <HStack spacing={2} flexShrink={0}>
        <Button
          onClick={onToggleMic}
          isDisabled={disabled}
          leftIcon={<Icon as={micOn ? Mic : MicOff} boxSize={4} />}
          variant="outline"
          borderRadius="xl"
          size="sm"
          borderColor={micOn ? 'green.400' : 'whiteAlpha.200'}
          color={micOn ? 'green.300' : 'whiteAlpha.800'}
          bg={micOn ? 'rgba(72,187,120,0.15)' : 'transparent'}
          _hover={{ bg: micOn ? 'rgba(72,187,120,0.25)' : 'whiteAlpha.100' }}
          _active={{ transform: 'scale(0.95)' }}
        >
          {micOn ? 'Mic on' : 'Mic off'}
        </Button>
        <Button
          onClick={onToggleShare}
          isDisabled={disabled}
          leftIcon={<Icon as={isSharing ? MonitorOff : Monitor} boxSize={4} />}
          borderRadius="xl"
          size="sm"
          bg={isSharing ? 'rgba(239,68,68,0.15)' : 'yellow.400'}
          color={isSharing ? 'red.300' : 'gray.900'}
          border="1px solid"
          borderColor={isSharing ? 'rgba(248,113,113,0.4)' : 'transparent'}
          _hover={{ bg: isSharing ? 'rgba(239,68,68,0.25)' : 'yellow.300' }}
          _active={{ transform: 'scale(0.95)' }}
          boxShadow={isSharing ? 'none' : '0 4px 14px rgba(236,201,75,0.3)'}
        >
          {isSharing ? 'Stop sharing' : 'Share screen'}
        </Button>
      </HStack>
    </Flex>
  );
}
