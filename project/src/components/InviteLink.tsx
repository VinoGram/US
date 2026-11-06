import { useEffect, useState } from 'react';
import { Box, Button, HStack, Icon, Text, VStack } from '@chakra-ui/react';
import { Check, Copy, Link } from 'lucide-react';

interface InviteLinkProps {
  roomCode: string;
}

export default function InviteLink({ roomCode }: InviteLinkProps) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;

  // Auto-copy to clipboard as soon as the component mounts
  useEffect(() => {
    navigator.clipboard.writeText(inviteUrl).then(() => setCopied(true)).catch(() => {});
  }, [inviteUrl]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 3000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyLink = () =>
    navigator.clipboard.writeText(inviteUrl).then(() => setCopied(true)).catch(() => {});

  return (
    <VStack align="center" spacing={4} w="full" maxW="md">
      <Text fontSize="sm" color="whiteAlpha.600" textAlign="center">
        Share this code or link — it's already copied to your clipboard.
      </Text>

      {/* Room code pill */}
      <Box
        borderRadius="xl"
        border="1px solid"
        borderColor="whiteAlpha.300"
        bg="blackAlpha.600"
        px={6}
        py={3}
      >
        <Text fontFamily="mono" fontSize="3xl" fontWeight="bold" letterSpacing="0.4em" color="yellow.300">
          {roomCode}
        </Text>
      </Box>

      {/* Copy link button */}
      <Button
        onClick={copyLink}
        leftIcon={<Icon as={copied ? Check : Link} boxSize={4} />}
        bg={copied ? 'green.500' : 'yellow.400'}
        color={copied ? 'white' : 'gray.900'}
        fontWeight="semibold"
        size="sm"
        borderRadius="lg"
        w="full"
        _hover={{ bg: copied ? 'green.400' : 'yellow.300' }}
        _active={{ transform: 'scale(0.95)' }}
      >
        {copied ? 'Link copied to clipboard!' : 'Copy invite link'}
      </Button>
    </VStack>
  );
}
