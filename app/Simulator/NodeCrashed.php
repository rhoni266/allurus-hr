<?php

namespace App\Simulator;

/** A simulated power cut on a print node: the object is discarded and a new one starts on the same files. */
final class NodeCrashed extends \RuntimeException {}
