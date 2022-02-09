<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}
require_once 'theme-options/theme-options.php';
if (defined('RESTLY_CORE')) {
    require_once 'team-metabox.php';
}
require_once 'post-format/post-video.php';
require_once 'post-format/post-gallery.php';
require_once 'post-format/post-audio.php';
require_once 'metabox-options.php';
